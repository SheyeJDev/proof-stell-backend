import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UseGuards,
  Logger,
  Body,
  Request,
} from '@nestjs/common';
import {
  ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiBody,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import {
  ConnectWalletDto,
  SignMessageDto,
  SendTransactionDto,
  SwitchNetworkDto,
} from './dtos/wallet.dto';
import type {
  WalletConnectionStatus,
  Signature,
} from './interfaces/wallet.interface';
import { WalletErrorInterceptor } from './interceptors/wallet-error.interceptor';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AuditLog } from '../audit/decorators/audit-log.decorator';
import { AuditLogInterceptor } from '../audit/interceptors/audit-log.interceptor';
import { AUDIT_ACTIONS } from '../audit/constants/audit-actions';

/**
 * Authenticated user shape injected by AuthGuard from the verified JWT.
 */
interface AuthenticatedUser {
  sub: string;
  email: string;
  role: string;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@UseInterceptors(WalletErrorInterceptor, AuditLogInterceptor)
@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

@ApiOperation({ summary: 'Connect a wallet provider (ArgentX or Braavos) for the authenticated user' })
@ApiBody({ type: ConnectWalletDto })
@ApiResponse({ status: 201, description: 'Wallet connected', })
@ApiResponse({ status: 400, description: 'Unsupported or unavailable provider' })
@ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
@Post('connect')

  @Post('connect')
  async connectWallet(
    @Body() body: ConnectWalletDto,
    @Request() req: { user: AuthenticatedUser },
  ): Promise<WalletConnectionStatus> {
    const userId = req.user?.sub;
    this.logger.log(
      `Received connect request for provider: ${body.providerName} (user: ${userId})`,
    );
    return this.walletService.connect(userId, body.providerName);
  }

  @Post('disconnect')
  async disconnectWallet(
    @Request() req: { user: AuthenticatedUser },
  ): Promise<{ message: string }> {
    const userId = req.user?.sub;
    this.logger.log(`Received disconnect request (user: ${userId}).`);
    await this.walletService.disconnect(userId);
    return { message: 'Wallet disconnected successfully.' };
  }

  @Get('status')
  getConnectionStatus(
    @Request() req: { user: AuthenticatedUser },
  ): WalletConnectionStatus {
    const userId = req.user?.sub;
    this.logger.log(`Received status request (user: ${userId}).`);
    return this.walletService.getConnectionStatus(userId);
  }

  @Get('accounts')
  async getAccounts(
    @Request() req: { user: AuthenticatedUser },
  ): Promise<string[]> {
    const userId = req.user?.sub;
    this.logger.log(`Received get accounts request (user: ${userId}).`);
    return this.walletService.getAccounts(userId);
  }

  @Get('chain-id')
  async getChainId(
    @Request() req: { user: AuthenticatedUser },
  ): Promise<string> {
    const userId = req.user?.sub;
    this.logger.log(`Received get chain ID request (user: ${userId}).`);
    return this.walletService.getChainId(userId);
  }

  @Post('sign-message')
  async signMessage(
    @Body() body: SignMessageDto,
    @Request() req: { user: AuthenticatedUser },
  ): Promise<{ signature: Signature }> {
    const userId = req.user?.sub;
    this.logger.log(
      `Received sign message request for address: ${body.address} (user: ${userId})`,
    );
    const signature = await this.walletService.signMessage(
      userId,
      body.message,
      body.address,
    );
    return { signature };
  }

@ApiOperation({
  summary: 'Relay a signed transaction to the connected StarkNet wallet',
  description:
    'requestId is used as an idempotency key — a duplicate requestId for the same user within the dedup window returns the original transaction hash instead of re-submitting. chainId is validated against the wallet\u2019s currently connected network; a mismatch returns 409.',
})
@ApiBody({ type: SendTransactionDto })
@ApiResponse({ status: 201, description: 'Transaction relayed, returns transactionHash' })
@ApiResponse({ status: 400, description: 'Invalid transaction payload' })
@ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
@ApiResponse({ status: 409, description: 'chainId does not match the wallet\u2019s active network' })
@Post('send-transaction')
@AuditLog({
  actionType: AUDIT_ACTIONS.TOKEN_TRANSFER,
  resource: 'blockchain:transfer',
  includeBody: true,
})

  @Post('send-transaction')
  @AuditLog({
    actionType: AUDIT_ACTIONS.TOKEN_TRANSFER,
    resource: 'blockchain:transfer',
    includeBody: true,
  })
  async sendTransaction(
    @Body() body: SendTransactionDto,
    @Request() req: { user: AuthenticatedUser },
  ): Promise<{ transactionHash: string }> {
    const userId = req.user?.sub;
    this.logger.log(
      `Received send transaction request from address: ${body.fromAddress} (user: ${userId})`,
    );
    const transactionRequest = {
      to: body.to,
      value: body.value,
      data: body.data,
      gasLimit: body.gasLimit,
      gasPrice: body.gasPrice,
      maxFeePerGas: body.maxFeePerGas,
      maxPriorityFeePerGas: body.maxPriorityFeePerGas,
      nonce: body.nonce,
      requestId: body.requestId,
      chainId: body.chainId,
    };
    const result = await this.walletService.sendTransaction(
      userId,
      transactionRequest,
      body.fromAddress,
    );
    return { transactionHash: result.hash };
  }

  @Post('switch-network')
  async switchNetwork(
    @Body() body: SwitchNetworkDto,
    @Request() req: { user: AuthenticatedUser },
  ): Promise<{ message: string }> {
    const userId = req.user?.sub;
    this.logger.log(
      `Received switch network request to chain ID: ${body.chainId} (user: ${userId})`,
    );
    await this.walletService.switchNetwork(userId, body.chainId);
    return { message: `Successfully switched to network ${body.chainId}.` };
  }
}
