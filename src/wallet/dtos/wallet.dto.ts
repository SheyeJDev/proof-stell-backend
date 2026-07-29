import {
  IsString,
  IsOptional,
  IsNotEmpty,
  IsNumberString,
} from 'class-validator';

export class ConnectWalletDto {
  @IsString()
  @IsNotEmpty()
  providerName: string; // e.g., "ArgentX", "Braavos"
}

export class SignMessageDto {
  @IsString()
  @IsNotEmpty()
  providerName: string;

  @IsString()
  @IsNotEmpty()
  address: string; // The wallet address to sign with

  @IsString()
  @IsNotEmpty()
  message: string; // The message to be signed
}

// This DTO represents a transaction request that the frontend would send to the backend
// for the backend to then potentially forward to a blockchain node or process.
// The actual signing and sending to the wallet extension happens on the frontend.
// The backend would typically receive a *signed* transaction or a request to *prepare* a transaction.
// For this example, we're simulating the backend receiving the raw transaction details
// and then "sending" it via the mock provider.
export class SendTransactionDto {
  @IsString()
  @IsNotEmpty()
  providerName: string;

  @IsString()
  @IsNotEmpty()
  fromAddress: string; // The address from which the transaction originates

  @IsOptional()
  @IsString()
  to?: string; // Recipient address

  @IsOptional()
  @IsNumberString() // Value can be a string representing a number
  value?: string; // Amount to send (e.g., in wei)

  @IsOptional()
  @IsString()
  data?: string; // Hex data for contract interaction

  @IsOptional()
  @IsNumberString()
  gasLimit?: string;

  @IsOptional()
  @IsNumberString()
  gasPrice?: string;

  @IsOptional()
  @IsNumberString()
  maxFeePerGas?: string;

  @IsOptional()
  @IsNumberString()
  maxPriorityFeePerGas?: string;

  @IsOptional()
  @IsNumberString()
  nonce?: string;

  @IsOptional()
  @IsString()
  requestId?: string; // Stable request identifier for idempotent retries

  @IsOptional()
  @IsString()
  chainId?: string; // The chain ID the transaction is targeting
}

export class SwitchNetworkDto {
  @IsString()
  @IsNotEmpty()
  providerName: string;

  @IsString()
  @IsNotEmpty()
  chainId: string; // The target chain ID to switch to
}