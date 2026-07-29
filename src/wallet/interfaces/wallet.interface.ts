/**
 * Represents a signature returned from wallet signing.
 */
export interface Signature {
  readonly r: string;
  readonly s: string;
  readonly v: string;
  serialized: string;
}

/**
 * Transaction request parameters.
 */
export interface TransactionRequest {
  to?: string;
  from?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
  requestId?: string;
  data?: string;
  value?: string;
  chainId?: string | number;
}
export interface WalletConnectionStatus {
  isConnected: boolean;
  address?: string;
  chainId?: string;
  providerName?: string;
}

/**
 * Defines the interface for a generic wallet provider.
 * Each specific wallet (e.g., ArgentX, Braavos) will implement this.
 * Note: In a real scenario, these methods would interact with the wallet's SDK,
 * often via a frontend proxy or by receiving signed data from the frontend.
 */
export interface WalletProvider {
  readonly name: string; // e.g., "ArgentX", "Braavos"
  isAvailable(): boolean; // Checks if the wallet provider is available (e.g., extension installed)
  connect(): Promise<WalletConnectionStatus>; // Simulates connecting to the wallet
  disconnect(): Promise<void>; // Simulates disconnecting from the wallet
  getAccounts(): Promise<string[]>; // Gets connected accounts
  getChainId(): Promise<string>; // Gets the current chain ID
  signMessage(message: string, address: string): Promise<Signature>; // Simulates signing a message
  sendTransaction(
    transaction: TransactionRequest,
    address: string,
  ): Promise<{ hash: string }>; // Simulates sending a transaction
  switchNetwork(chainId: string): Promise<void>; // Simulates switching network
}

/**
 * Common properties for wallet-related events.
 */
export interface WalletEvent {
  timestamp: Date;
  providerName: string;
  address?: string;
  chainId?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Event emitted when a wallet successfully connects.
 */
export interface WalletConnectedEvent extends WalletEvent {
  event: 'wallet.connected';
}

/**
 * Event emitted when a wallet disconnects.
 */
export interface WalletDisconnectedEvent extends WalletEvent {
  event: 'wallet.disconnected';
}

/**
 * Event emitted when a transaction is successfully sent.
 */
export interface WalletTransactionSentEvent extends WalletEvent {
  event: 'wallet.transaction.sent';
  transactionHash: string;
  transactionDetails: TransactionRequest;
}

/**
 * Event emitted when a transaction is rejected by the user.
 */
export interface WalletTransactionRejectedEvent extends WalletEvent {
  event: 'wallet.transaction.rejected';
  transactionDetails: TransactionRequest;
}

/**
 * Event emitted when a network switch occurs.
 */
export interface WalletNetworkSwitchedEvent extends WalletEvent {
  event: 'wallet.network.switched';
  oldChainId: string;
  newChainId: string;
}

/**
 * Event emitted when a wallet operation fails due to a connection error.
 */
export interface WalletConnectionErrorEvent extends WalletEvent {
  event: 'wallet.connection.error';
}

/**
 * Event emitted when a wallet operation fails due to an unknown error.
 */
export interface WalletErrorEvent extends WalletEvent {
  event: 'wallet.error';
}
