import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { UserEntity } from './user.entity';

@Entity({ name: 'documents' })
export class DocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId: string;

  @ManyToOne(() => UserEntity, (user) => user.documents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'owner_id' })
  owner: UserEntity;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'varchar', name: 'original_name', length: 255 })
  originalName: string;

  @Column({ type: 'varchar', name: 'stored_name', length: 255 })
  storedName: string;

  @Column({ type: 'varchar', name: 'mime_type', length: 150 })
  mimeType: string;

  @Column({ type: 'integer', name: 'size_bytes' })
  sizeBytes: number;

  @Column({ type: 'text', name: 'storage_path' })
  storagePath: string;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt: Date;
}
