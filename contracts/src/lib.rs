#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    token, Address, Env, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum EscrowError {
    GameAlreadyExists = 1,
    GameNotFound = 2,
    InvalidGameState = 3,
    Unauthorized = 4,
    InvalidWinner = 5,
    StakeMustBePositive = 6,
    CannotPlaySelf = 7,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum GameState {
    WaitingForOpponent = 0,
    Active = 1,
    Resolved = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Game {
    pub player_w: Address,
    pub player_b: Option<Address>,
    pub arbiter: Address,
    pub token: Address,
    pub stake_amount: i128,
    pub state: GameState,
    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Game(Symbol),
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initializes a new chess escrow game.
    /// Deducts `stake_amount` from `creator` and locks it into the contract.
    pub fn create_game(
        env: Env,
        game_id: Symbol,
        creator: Address,
        arbiter: Address,
        token: Address,
        stake_amount: i128,
    ) -> Result<(), EscrowError> {
        if stake_amount <= 0 {
            return Err(EscrowError::StakeMustBePositive);
        }

        creator.require_auth();

        let key = DataKey::Game(game_id);
        if env.storage().persistent().has(&key) {
            return Err(EscrowError::GameAlreadyExists);
        }

        // Lock stake from creator into escrow contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&creator, &env.current_contract_address(), &stake_amount);

        let game = Game {
            player_w: creator,
            player_b: None,
            arbiter,
            token,
            stake_amount,
            state: GameState::WaitingForOpponent,
            winner: None,
        };

        env.storage().persistent().set(&key, &game);
        Ok(())
    }

    /// Opponent joins an existing game, depositing an equal stake amount.
    /// Transitions state from `WaitingForOpponent` to `Active`.
    pub fn join_game(
        env: Env,
        game_id: Symbol,
        opponent: Address,
    ) -> Result<(), EscrowError> {
        opponent.require_auth();

        let key = DataKey::Game(game_id);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::GameNotFound)?;

        if game.state != GameState::WaitingForOpponent {
            return Err(EscrowError::InvalidGameState);
        }

        if game.player_w == opponent {
            return Err(EscrowError::CannotPlaySelf);
        }

        // Lock matching stake from opponent into escrow contract
        let token_client = token::Client::new(&env, &game.token);
        token_client.transfer(&opponent, &env.current_contract_address(), &game.stake_amount);

        game.player_b = Some(opponent);
        game.state = GameState::Active;

        env.storage().persistent().set(&key, &game);
        Ok(())
    }

    /// Authoritative resolution invoked exclusively by the designated arbiter.
    /// Releases the total pot (`stake_amount * 2`) to the verified winner.
    pub fn resolve_game(
        env: Env,
        game_id: Symbol,
        winner: Address,
    ) -> Result<(), EscrowError> {
        let key = DataKey::Game(game_id);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::GameNotFound)?;

        if game.state != GameState::Active {
            return Err(EscrowError::InvalidGameState);
        }

        // Must be authorized by the trusted game arbiter
        game.arbiter.require_auth();

        let player_b = game.player_b.as_ref().ok_or(EscrowError::InvalidGameState)?;

        // Winner must be either player_w or player_b
        if winner != game.player_w && &winner != player_b {
            return Err(EscrowError::InvalidWinner);
        }

        // Calculate total pot (2 * stake_amount)
        let total_pot = game
            .stake_amount
            .checked_mul(2)
            .ok_or(EscrowError::StakeMustBePositive)?;

        let token_client = token::Client::new(&env, &game.token);
        token_client.transfer(&env.current_contract_address(), &winner, &total_pot);

        game.state = GameState::Resolved;
        game.winner = Some(winner);

        env.storage().persistent().set(&key, &game);
        Ok(())
    }

    /// Cancels a match if an opponent has not yet joined.
    /// Refunds the original stake to the creator.
    pub fn cancel_game(
        env: Env,
        game_id: Symbol,
    ) -> Result<(), EscrowError> {
        let key = DataKey::Game(game_id);
        let mut game: Game = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(EscrowError::GameNotFound)?;

        if game.state != GameState::WaitingForOpponent {
            return Err(EscrowError::InvalidGameState);
        }

        // Creator must authorize the cancellation
        game.player_w.require_auth();

        // Refund creator
        let token_client = token::Client::new(&env, &game.token);
        token_client.transfer(&env.current_contract_address(), &game.player_w, &game.stake_amount);

        game.state = GameState::Cancelled;
        env.storage().persistent().set(&key, &game);
        Ok(())
    }

    /// Read game details for client/arbiter verification.
    pub fn get_game(env: Env, game_id: Symbol) -> Result<Game, EscrowError> {
        let key = DataKey::Game(game_id);
        env.storage().persistent().get(&key).ok_or(EscrowError::GameNotFound)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::Address as _,
        token::{Client as TokenClient, StellarAssetClient},
        symbol_short, Address, Env,
    };

    fn create_test_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
        let contract_address = env.register_stellar_asset_contract_v2(admin.clone());
        (
            TokenClient::new(env, &contract_address.address()),
            StellarAssetClient::new(env, &contract_address.address()),
        )
    }

    #[test]
    fn test_full_escrow_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let (token_client, token_admin_client) = create_test_token(&env, &token_admin);

        let player_w = Address::generate(&env);
        let player_b = Address::generate(&env);
        let arbiter = Address::generate(&env);

        let stake_amount = 100_i128;

        // Mint initial tokens to players
        token_admin_client.mint(&player_w, &500);
        token_admin_client.mint(&player_b, &500);

        assert_eq!(token_client.balance(&player_w), 500);
        assert_eq!(token_client.balance(&player_b), 500);

        let game_id = symbol_short!("GAME01");

        // 1. Creator creates game
        client.create_game(&game_id, &player_w, &arbiter, &token_client.address, &stake_amount);

        assert_eq!(token_client.balance(&player_w), 400);
        assert_eq!(token_client.balance(&contract_id), 100);

        let game_state = client.get_game(&game_id);
        assert_eq!(game_state.state, GameState::WaitingForOpponent);
        assert_eq!(game_state.player_b, None);

        // 2. Opponent joins game
        client.join_game(&game_id, &player_b);

        assert_eq!(token_client.balance(&player_b), 400);
        assert_eq!(token_client.balance(&contract_id), 200);

        let active_state = client.get_game(&game_id);
        assert_eq!(active_state.state, GameState::Active);
        assert_eq!(active_state.player_b, Some(player_b.clone()));

        // 3. Arbiter resolves game with player_w as winner
        client.resolve_game(&game_id, &player_w);

        let resolved_state = client.get_game(&game_id);
        assert_eq!(resolved_state.state, GameState::Resolved);
        assert_eq!(resolved_state.winner, Some(player_w.clone()));

        // Contract balance emptied, winner received 200 tokens (initial 400 + 200 = 600)
        assert_eq!(token_client.balance(&contract_id), 0);
        assert_eq!(token_client.balance(&player_w), 600);
        assert_eq!(token_client.balance(&player_b), 400);
    }

    #[test]
    fn test_cancel_game_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let (token_client, token_admin_client) = create_test_token(&env, &token_admin);

        let player_w = Address::generate(&env);
        let arbiter = Address::generate(&env);
        let stake_amount = 50_i128;

        token_admin_client.mint(&player_w, &200);

        let game_id = symbol_short!("CANCEL1");

        // 1. Create game
        client.create_game(&game_id, &player_w, &arbiter, &token_client.address, &stake_amount);
        assert_eq!(token_client.balance(&player_w), 150);
        assert_eq!(token_client.balance(&contract_id), 50);

        // 2. Cancel game before opponent joins
        client.cancel_game(&game_id);

        // Creator refunded in full
        assert_eq!(token_client.balance(&player_w), 200);
        assert_eq!(token_client.balance(&contract_id), 0);

        let state = client.get_game(&game_id);
        assert_eq!(state.state, GameState::Cancelled);
    }

    #[test]
    #[should_panic]
    fn test_cannot_play_self() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let (token_client, token_admin_client) = create_test_token(&env, &token_admin);

        let player_w = Address::generate(&env);
        let arbiter = Address::generate(&env);

        token_admin_client.mint(&player_w, &500);

        let game_id = symbol_short!("SELF");
        client.create_game(&game_id, &player_w, &arbiter, &token_client.address, &100);

        // Same player cannot join
        client.join_game(&game_id, &player_w);
    }

    #[test]
    #[should_panic]
    fn test_invalid_winner() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(EscrowContract, ());
        let client = EscrowContractClient::new(&env, &contract_id);

        let token_admin = Address::generate(&env);
        let (token_client, token_admin_client) = create_test_token(&env, &token_admin);

        let player_w = Address::generate(&env);
        let player_b = Address::generate(&env);
        let third_party = Address::generate(&env);
        let arbiter = Address::generate(&env);

        token_admin_client.mint(&player_w, &500);
        token_admin_client.mint(&player_b, &500);

        let game_id = symbol_short!("INVAL");
        client.create_game(&game_id, &player_w, &arbiter, &token_client.address, &100);
        client.join_game(&game_id, &player_b);

        // Resolving with third party must fail
        client.resolve_game(&game_id, &third_party);
    }
}
