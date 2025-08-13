import mongoose, { Schema, Document } from 'mongoose';

export interface IVerificationSession {
  userId: number;
  groupId: number;
  verificationCode: string;
  isCompleted: boolean;
  expiresAt: Date;
  messageId?: number;
}

export interface IVerificationSessionDocument extends IVerificationSession, Document {}

const verificationSessionSchema = new Schema<IVerificationSessionDocument>({
  userId: {
    type: Number,
    required: true,
    index: true
  },
  groupId: {
    type: Number,
    required: true,
    index: true
  },
  verificationCode: {
    type: String,
    required: true
  },
  isCompleted: {
    type: Boolean,
    required: true,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 } // TTL index for automatic cleanup
  },
  messageId: {
    type: Number,
    required: false
  }
}, {
  timestamps: true
});

verificationSessionSchema.index({ userId: 1, groupId: 1 });
verificationSessionSchema.index({ verificationCode: 1 });
verificationSessionSchema.index({ isCompleted: 1 });

export const VerificationSession = mongoose.model<IVerificationSessionDocument>('VerificationSession', verificationSessionSchema);