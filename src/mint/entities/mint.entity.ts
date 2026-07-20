import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

export enum MintStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@Entity()
export class Mint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @Column({ nullable: true })
  transactionHash: string;

  @Column({
    type: 'enum',
    enum: MintStatus,
    default: MintStatus.PENDING,
  })
  status: MintStatus;

  @Column({ type: 'integer', nullable: true })
  blockNumber: number;

  @Column({ type: 'jsonb', nullable: true })
  receipt: Record<string, any>;
}
