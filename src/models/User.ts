import mongoose, { Schema, Document } from 'mongoose';

export interface IUser {
  userId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  isVerified: boolean;
  verificationDate?: Date;
  joinDate: Date;
  groups: number[];
  
  // $TAX Points System
  taxPoints: number;
  totalPointsEarned: number;
  lastActivityDate?: Date;
  messagesCount: number;
  dailyStreak: number;
  lastStreakDate?: Date;
  lastPointAward?: Date;
  
  // Activity Tracking per Group
  groupActivity: Array<{
    groupId: number;
    messagesCount: number;
    pointsEarned: number;
    lastMessageDate?: Date;
    dailyPoints: number;
    lastDailyReset?: Date;
  }>;
}

export interface IUserDocument extends IUser, Document {
  awardPoints(points: number, groupId?: number): Promise<this>;
  incrementMessages(groupId?: number): Promise<this>;
  updateStreak(): Promise<this>;
}

const userSchema = new Schema<IUserDocument>({
  userId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    required: false
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    required: false
  },
  isVerified: {
    type: Boolean,
    required: true,
    default: false
  },
  verificationDate: {
    type: Date,
    required: false
  },
  joinDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  groups: [{
    type: Number,
    required: true
  }],
  
  // $TAX Points System
  taxPoints: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  totalPointsEarned: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  lastActivityDate: {
    type: Date,
    required: false
  },
  messagesCount: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  dailyStreak: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  lastStreakDate: {
    type: Date,
    required: false
  },
  lastPointAward: {
    type: Date,
    required: false
  },
  
  // Group-specific activity tracking
  groupActivity: [{
    groupId: {
      type: Number,
      required: true
    },
    messagesCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    pointsEarned: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    lastMessageDate: {
      type: Date,
      required: false
    },
    dailyPoints: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    lastDailyReset: {
      type: Date,
      required: false
    }
  }]
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ userId: 1, groups: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ taxPoints: -1 }); // For leaderboards
userSchema.index({ totalPointsEarned: -1 }); // For all-time leaderboards
userSchema.index({ dailyStreak: -1 }); // For streak leaderboards
userSchema.index({ 'groupActivity.groupId': 1, 'groupActivity.pointsEarned': -1 }); // Group leaderboards

// Helper methods
userSchema.methods.awardPoints = function(points: number, groupId?: number) {
  this.taxPoints += points;
  this.totalPointsEarned += points;
  this.lastActivityDate = new Date();
  this.lastPointAward = new Date();
  
  if (groupId) {
    const groupActivity = this.groupActivity.find((g: any) => g.groupId === groupId);
    if (groupActivity) {
      groupActivity.pointsEarned += points;
      groupActivity.lastMessageDate = new Date();
    } else {
      this.groupActivity.push({
        groupId,
        messagesCount: 0,
        pointsEarned: points,
        lastMessageDate: new Date(),
        dailyPoints: 0
      });
    }
  }
  
  return this.save();
};

userSchema.methods.incrementMessages = function(groupId?: number) {
  this.messagesCount += 1;
  
  if (groupId) {
    const groupActivity = this.groupActivity.find((g: any) => g.groupId === groupId);
    if (groupActivity) {
      groupActivity.messagesCount += 1;
      groupActivity.lastMessageDate = new Date();
    } else {
      this.groupActivity.push({
        groupId,
        messagesCount: 1,
        pointsEarned: 0,
        lastMessageDate: new Date(),
        dailyPoints: 0
      });
    }
  }
  
  return this.save();
};

userSchema.methods.updateStreak = function() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastStreakDay = this.lastStreakDate 
    ? new Date(this.lastStreakDate.getFullYear(), this.lastStreakDate.getMonth(), this.lastStreakDate.getDate())
    : null;
  
  if (!lastStreakDay) {
    // First time
    this.dailyStreak = 1;
  } else {
    const daysDiff = Math.floor((today.getTime() - lastStreakDay.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysDiff === 1) {
      // Consecutive day
      this.dailyStreak += 1;
    } else if (daysDiff > 1) {
      // Streak broken
      this.dailyStreak = 1;
    }
    // Same day = no change
  }
  
  this.lastStreakDate = now;
  return this.save();
};

export const User = mongoose.model<IUserDocument>('User', userSchema);