import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { MintService } from './mint.service';
import { MintResponseDto } from './dto/create-mint.dto';
import { UpdateMintDto } from './dto/update-mint.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { AuditLog } from 'src/audit/decorators/audit-log.decorator';
import { AuditLogInterceptor } from 'src/audit/interceptors/audit-log.interceptor';
import { AUDIT_ACTIONS } from 'src/audit/constants/audit-actions';

@Controller('mint')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditLogInterceptor)
export class MintController {
  constructor(private readonly mintService: MintService) {}

  @Post('mint')
  @AuditLog({
    actionType: AUDIT_ACTIONS.TOKEN_MINT,
    resource: 'blockchain:mint',
    includeBody: true,
  })
  public async mint(@Req() req): Promise<MintResponseDto> {
    const mint = await this.mintService.mint(req.user.id);
    const explorerUrl = `https://voyager.online/tx/${mint.transactionHash}`;

    return {
      success: true,
      transactionHash: mint.transactionHash,
      explorerUrl,
    };
  }

  @Get()
  findAll() {
    return this.mintService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.mintService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateMintDto: UpdateMintDto) {
    return this.mintService.update(+id, updateMintDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.mintService.remove(+id);
  }
}
