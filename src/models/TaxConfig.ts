import mongoose, { Schema, Document } from 'mongoose';

export interface ITaxConfig {
  // Configuration metadata
  version: number;
  lastUpdated: Date;
  updatedBy?: number; // Admin user ID who made changes
  isActive: boolean;
  
  // Base awards
  welcomeBonus: number;
  baseMessagePoints: number;
  dailyFirstMessageBonus: number;
  
  // Quality multipliers
  minMessageLength: number;
  qualityMessageLength: number;
  qualityMultiplier: number;
  replyBonus: number;
  
  // Streak system
  streakMultipliers: Array<{
    days: number;
    multiplier: number;
  }>;
  maxStreakMultiplier: number;
  
  // Anti-spam protection
  cooldownSeconds: number;
  maxPointsPerHour: number;
  maxPointsPerDay: number;
  diminishingReturnsThreshold: number;
  diminishingReturnsFactor: number;
  
  // Special bonuses
  milestoneRewards: Array<{
    points: number;
    bonus: number;
  }>;
  weekendMultiplier: number;
  nightOwlBonus: {
    startHour: number;
    endHour: number;
    bonus: number;
  };
  
  // Feature toggles
  enableWelcomeBonus: boolean;
  enableDailyBonus: boolean;
  enableStreakMultiplier: boolean;
  enableQualityMultiplier: boolean;
  enableTimeMultiplier: boolean;
  enableMilestoneRewards: boolean;
  enablePointNotifications: boolean;
  
  // Notification settings
  notificationThreshold: number; // Minimum points to trigger notification
  enableRankNotifications: boolean;
  enableStreakNotifications: boolean;
  
  // Group-specific overrides
  groupOverrides: Array<{
    groupId: number;
    overrides: {
      baseMessagePoints?: number;
      maxPointsPerDay?: number;
      welcomeBonus?: number;
      [key: string]: any;
    };
  }>;
}

export interface ITaxConfigDocument extends ITaxConfig, Document {}

const taxConfigSchema = new Schema<ITaxConfigDocument>({
  // Configuration metadata
  version: {
    type: Number,
    required: true,
    default: 1
  },
  lastUpdated: {
    type: Date,
    required: true,
    default: Date.now
  },
  updatedBy: {
    type: Number,
    required: false
  },
  isActive: {
    type: Boolean,
    required: true,
    default: true
  },
  
  // Base awards
  welcomeBonus: {
    type: Number,
    required: true,
    default: 500,
    min: 0,
    max: 10000
  },
  baseMessagePoints: {
    type: Number,
    required: true,
    default: 2,
    min: 0,
    max: 100
  },
  dailyFirstMessageBonus: {
    type: Number,
    required: true,
    default: 50,
    min: 0,
    max: 1000
  },
  
  // Quality multipliers
  minMessageLength: {
    type: Number,
    required: true,
    default: 5,
    min: 1,
    max: 100
  },
  qualityMessageLength: {
    type: Number,
    required: true,
    default: 30,
    min: 1,
    max: 500
  },
  qualityMultiplier: {
    type: Number,
    required: true,
    default: 1.5,
    min: 1,
    max: 5
  },
  replyBonus: {
    type: Number,
    required: true,
    default: 3,
    min: 0,
    max: 50
  },
  
  // Streak system
  streakMultipliers: [{
    days: {
      type: Number,
      required: true,
      min: 1
    },
    multiplier: {
      type: Number,
      required: true,
      min: 1,
      max: 10
    }
  }],
  maxStreakMultiplier: {
    type: Number,
    required: true,
    default: 2.5,
    min: 1,
    max: 10
  },
  
  // Anti-spam protection
  cooldownSeconds: {
    type: Number,
    required: true,
    default: 30,
    min: 0,
    max: 3600
  },
  maxPointsPerHour: {
    type: Number,
    required: true,
    default: 100,
    min: 1,
    max: 10000
  },
  maxPointsPerDay: {
    type: Number,
    required: true,
    default: 500,
    min: 1,
    max: 50000
  },
  diminishingReturnsThreshold: {
    type: Number,
    required: true,
    default: 20,
    min: 1,
    max: 1000
  },
  diminishingReturnsFactor: {
    type: Number,
    required: true,
    default: 0.7,
    min: 0.1,
    max: 1
  },
  
  // Special bonuses
  milestoneRewards: [{
    points: {
      type: Number,
      required: true,
      min: 1
    },
    bonus: {
      type: Number,
      required: true,
      min: 1
    }
  }],
  weekendMultiplier: {
    type: Number,
    required: true,
    default: 1.3,
    min: 1,
    max: 5
  },
  nightOwlBonus: {
    startHour: {
      type: Number,
      required: true,
      default: 22,
      min: 0,
      max: 23
    },
    endHour: {
      type: Number,
      required: true,
      default: 6,
      min: 0,
      max: 23
    },
    bonus: {
      type: Number,
      required: true,
      default: 1.2,
      min: 1,
      max: 5
    }
  },
  
  // Feature toggles
  enableWelcomeBonus: {
    type: Boolean,
    required: true,
    default: true
  },
  enableDailyBonus: {
    type: Boolean,
    required: true,
    default: true
  },
  enableStreakMultiplier: {
    type: Boolean,
    required: true,
    default: true
  },
  enableQualityMultiplier: {
    type: Boolean,
    required: true,
    default: true
  },
  enableTimeMultiplier: {
    type: Boolean,
    required: true,
    default: true
  },
  enableMilestoneRewards: {
    type: Boolean,
    required: true,
    default: true
  },
  enablePointNotifications: {
    type: Boolean,
    required: true,
    default: false
  },
  
  // Notification settings
  notificationThreshold: {
    type: Number,
    required: true,
    default: 10,
    min: 0,
    max: 1000
  },
  enableRankNotifications: {
    type: Boolean,
    required: true,
    default: false
  },
  enableStreakNotifications: {
    type: Boolean,
    required: true,
    default: true
  },
  
  // Group-specific overrides
  groupOverrides: [{
    groupId: {
      type: Number,
      required: true
    },
    overrides: {
      type: Schema.Types.Mixed,
      required: true,
      default: {}
    }
  }]
}, {
  timestamps: true
});

// Indexes
taxConfigSchema.index({ version: -1, isActive: 1 });
taxConfigSchema.index({ lastUpdated: -1 });
taxConfigSchema.index({ 'groupOverrides.groupId': 1 });

// Static method to get default configuration
taxConfigSchema.statics.getDefaultConfig = function(): ITaxConfig {
  return {
    version: 1,
    lastUpdated: new Date(),
    isActive: true,
    
    // Base awards
    welcomeBonus: 500,
    baseMessagePoints: 2,
    dailyFirstMessageBonus: 50,
    
    // Quality multipliers
    minMessageLength: 5,
    qualityMessageLength: 30,
    qualityMultiplier: 1.5,
    replyBonus: 3,
    
    // Streak system
    streakMultipliers: [
      { days: 3, multiplier: 1.2 },
      { days: 7, multiplier: 1.5 },
      { days: 14, multiplier: 1.8 },
      { days: 30, multiplier: 2.0 }
    ],
    maxStreakMultiplier: 2.5,
    
    // Anti-spam protection
    cooldownSeconds: 30,
    maxPointsPerHour: 100,
    maxPointsPerDay: 500,
    diminishingReturnsThreshold: 20,
    diminishingReturnsFactor: 0.7,
    
    // Special bonuses
    milestoneRewards: [
      { points: 1000, bonus: 100 },
      { points: 5000, bonus: 250 },
      { points: 10000, bonus: 500 },
      { points: 25000, bonus: 1000 }
    ],
    weekendMultiplier: 1.3,
    nightOwlBonus: { startHour: 22, endHour: 6, bonus: 1.2 },
    
    // Feature toggles
    enableWelcomeBonus: true,
    enableDailyBonus: true,
    enableStreakMultiplier: true,
    enableQualityMultiplier: true,
    enableTimeMultiplier: true,
    enableMilestoneRewards: true,
    enablePointNotifications: false,
    
    // Notification settings
    notificationThreshold: 10,
    enableRankNotifications: false,
    enableStreakNotifications: true,
    
    // Group overrides
    groupOverrides: []
  };
};

export const TaxConfig = mongoose.model<ITaxConfigDocument>('TaxConfig', taxConfigSchema);