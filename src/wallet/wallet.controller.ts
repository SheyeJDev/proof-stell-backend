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
import { WalletService } from './wallet.service';
import type {
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

@UseInterceptors(WalletErrorInterceptor, AuditLogInterceptor)
@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

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
