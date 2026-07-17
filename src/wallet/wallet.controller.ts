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

@UseInterceptors(WalletErrorInterceptor, AuditLogInterceptor)
@UseGuards(AuthGuard)
@Controller('wallet')
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(private readonly walletService: WalletService) {}

  @Post('connect')
  async connectWallet(
    @Body() body: ConnectWalletDto,
    @Request() req: { user: { userId: string } },
  ): Promise<WalletConnectionStatus> {
    this.logger.log(
      `Received connect request for provider: ${body.providerName}`,
    );
    return this.walletService.connect(req.user.userId, body.providerName);
  }

  @Post('disconnect')
  async disconnectWallet(
    @Request() req: { user: { userId: string } },
  ): Promise<{ message: string }> {
    this.logger.log('Received disconnect request.');
    await this.walletService.disconnect(req.user.userId);
    return { message: 'Wallet disconnected successfully.' };
  }

  @Get('status')
  getConnectionStatus(
    @Request() req: { user: { userId: string } },
  ): WalletConnectionStatus {
    this.logger.log('Received status request.');
    return this.walletService.getConnectionStatus(req.user.userId);
  }

  @Get('accounts')
  async getAccounts(
    @Request() req: { user: { userId: string } },
  ): Promise<string[]> {
    this.logger.log('Received get accounts request.');
    return this.walletService.getAccounts(req.user.userId);
  }

  @Get('chain-id')
  async getChainId(
    @Request() req: { user: { userId: string } },
  ): Promise<string> {
    this.logger.log('Received get chain ID request.');
    return this.walletService.getChainId(req.user.userId);
  }

  @Post('sign-message')
  async signMessage(
    @Body() body: SignMessageDto,
    @Request() req: { user: { userId: string } },
  ): Promise<{ signature: Signature }> {
    this.logger.log(
      `Received sign message request for address: ${body.address}`,
    );
    const signature = await this.walletService.signMessage(
      req.user.userId,
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
    @Request() req: { user: { userId: string } },
  ): Promise<{ transactionHash: string }> {
    this.logger.log(
      `Received send transaction request from address: ${body.fromAddress}`,
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
      chainId: body.chainId,
    };
    const result = await this.walletService.sendTransaction(
      req.user.userId,
      transactionRequest,
      body.fromAddress,
    );
    return { transactionHash: result.hash };
  }

  @Post('switch-network')
  async switchNetwork(
    @Body() body: SwitchNetworkDto,
    @Request() req: { user: { userId: string } },
  ): Promise<{ message: string }> {
    this.logger.log(
      `Received switch network request to chain ID: ${body.chainId}`,
    );
    await this.walletService.switchNetwork(req.user.userId, body.chainId);
    return { message: `Successfully switched to network ${body.chainId}.` };
  }
}
