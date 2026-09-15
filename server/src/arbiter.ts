import {
  Keypair,
  Networks,
  rpc,
  Contract,
  nativeToScVal,
  TransactionBuilder,
  BASE_FEE
} from '@stellar/stellar-sdk';
import dotenv from 'dotenv';

dotenv.config();

export interface EscrowResolutionResult {
  success: boolean;
  txHash?: string;
  simulated: boolean;
  error?: string;
}

export class ArbiterService {
  private keypair: Keypair | null = null;
  private rpcServer: rpc.Server;
  private networkPassphrase: string;
  private defaultContractId: string | null;

  constructor() {
    this.networkPassphrase =
      process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
    const rpcUrl =
      process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
    this.rpcServer = new rpc.Server(rpcUrl);
    this.defaultContractId = process.env.ESCROW_CONTRACT_ID || null;

    const secretKey = process.env.ARBITER_SECRET_KEY;
    if (secretKey && secretKey.startsWith('S') && secretKey.length === 56) {
      try {
        this.keypair = Keypair.fromSecret(secretKey);
        console.log(`[Arbiter] Initialized with public key: ${this.keypair.publicKey()}`);
      } catch (err) {
        console.warn('[Arbiter] Invalid ARBITER_SECRET_KEY in environment. Running in mock/simulation mode.');
      }
    } else {
      // Ephemeral fallback keypair for local development/simulation
      this.keypair = Keypair.random();
      console.log(`[Arbiter] No valid ARBITER_SECRET_KEY configured. Running in simulation mode with ephemeral key: ${this.keypair.publicKey()}`);
    }
  }

  public getPublicKey(): string {
    return this.keypair ? this.keypair.publicKey() : 'UNCONFIGURED';
  }

  public isLive(): boolean {
    return (
      Boolean(process.env.ARBITER_SECRET_KEY) &&
      Boolean(this.defaultContractId || process.env.ESCROW_CONTRACT_ID)
    );
  }

  /**
   * Resolves a completed wager match on Soroban escrow contract.
   * Invokes the contract's `resolve` function:
   * resolve(room_id: Symbol/String, winner: Option<Address>, is_draw: bool)
   */
  public async resolveEscrowMatch(params: {
    roomId: string;
    winnerAddress: string | null;
    isDraw: boolean;
    contractId?: string;
  }): Promise<EscrowResolutionResult> {
    const { roomId, winnerAddress, isDraw, contractId } = params;
    const targetContract = contractId || this.defaultContractId;

    console.log(
      `[Arbiter] Processing escrow resolution for Room: ${roomId} | Winner: ${winnerAddress || 'None (Draw)'} | isDraw: ${isDraw}`
    );

    // If live contract address is not configured or in dev simulation
    if (!targetContract || !this.keypair || !process.env.ARBITER_SECRET_KEY) {
      const simulatedHash = `sim_tx_${roomId}_${Date.now().toString(16)}`;
      console.log(`[Arbiter:Simulation] Mock escrow payout dispatched. Simulated TxHash: ${simulatedHash}`);
      return {
        success: true,
        txHash: simulatedHash,
        simulated: true
      };
    }

    try {
      const contract = new Contract(targetContract);

      // Fetch latest arbiter account sequence
      const sourceAccount = await this.rpcServer.getAccount(this.keypair.publicKey());

      // Prepare contract invocation arguments
      // fn resolve(env: Env, room_id: String, winner: Option<Address>, is_draw: bool)
      const args = [
        nativeToScVal(roomId, { type: 'string' }),
        winnerAddress
          ? nativeToScVal(winnerAddress, { type: 'address' })
          : nativeToScVal(null),
        nativeToScVal(isDraw, { type: 'bool' })
      ];

      const callOp = contract.call('resolve', ...args);

      let tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase
      })
        .addOperation(callOp)
        .setTimeout(30)
        .build();

      // Simulate transaction to get footprint and resource fee
      const preparedTx = await this.rpcServer.prepareTransaction(tx);
      preparedTx.sign(this.keypair);

      const sendResponse = await this.rpcServer.sendTransaction(preparedTx);

      if (sendResponse.status === 'ERROR') {
        console.error('[Arbiter] Transaction submission failed:', sendResponse);
        return {
          success: false,
          error: 'Transaction failed submission to Soroban RPC',
          simulated: false
        };
      }

      console.log(`[Arbiter] Payout tx sent! Hash: ${sendResponse.hash}`);

      return {
        success: true,
        txHash: sendResponse.hash,
        simulated: false
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown contract invocation error';
      console.error(`[Arbiter] Error resolving escrow on-chain: ${message}`);
      return {
        success: false,
        error: message,
        simulated: false
      };
    }
  }
}

export const arbiter = new ArbiterService();
