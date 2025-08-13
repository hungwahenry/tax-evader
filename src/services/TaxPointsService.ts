import { Context } from 'telegraf';
import { User, IUserDocument } from '../models/User';

export interface PointsConfig {
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
  streakMultipliers: { days: number; multiplier: number }[];
  maxStreakMultiplier: number;
  
  // Anti-spam protection
  cooldownSeconds: number;
  maxPointsPerHour: number;
  maxPointsPerDay: number;
  diminishingReturnsThreshold: number;
  diminishingReturnsFactor: number;
  
  // Special bonuses
  milestoneRewards: { points: number; bonus: number }[];
  weekendMultiplier: number;
  nightOwlBonus: { startHour: number; endHour: number; bonus: number };
}

export class TaxPointsService {
  private readonly config: PointsConfig = {
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
    diminishingReturnsThreshold: 20, // messages per hour
    diminishingReturnsFactor: 0.7,
    
    // Special bonuses
    milestoneRewards: [
      { points: 1000, bonus: 100 },
      { points: 5000, bonus: 250 },
      { points: 10000, bonus: 500 },
      { points: 25000, bonus: 1000 }
    ],
    weekendMultiplier: 1.3,
    nightOwlBonus: { startHour: 22, endHour: 6, bonus: 1.2 }
  };

  async awardWelcomeBonus(userId: number): Promise<number> {
    try {
      const user = await User.findOne({ userId });
      if (!user) return 0;

      const points = this.config.welcomeBonus;
      await user.awardPoints(points);
      
      console.log(`🎉 Welcome bonus: ${points} $TAX awarded to user ${userId}`);
      return points;
    } catch (error) {
      console.error('❌ Error awarding welcome bonus:', error);
      return 0;
    }
  }

  async processMessagePoints(ctx: Context, messageText: string): Promise<number> {
    try {
      if (!ctx.from || !ctx.chat) return 0;

      const user = await User.findOne({ userId: ctx.from.id });
      if (!user || !user.isVerified) return 0;

      // Check cooldown
      if (!this.canAwardPoints(user)) {
        return 0;
      }

      // Check daily limits
      const groupActivity = user.groupActivity.find(g => g.groupId === ctx.chat!.id);
      if (groupActivity && !this.canAwardDailyPoints(groupActivity)) {
        return 0;
      }

      // Calculate base points
      let points = await this.calculateMessagePoints(user, messageText, ctx);
      
      if (points <= 0) return 0;

      // Award points
      await user.awardPoints(points, ctx.chat.id);
      await user.incrementMessages(ctx.chat.id);

      // Check for milestones
      const milestoneBonus = this.checkMilestone(user.taxPoints - points, user.taxPoints);
      if (milestoneBonus > 0) {
        await user.awardPoints(milestoneBonus);
        console.log(`🏆 Milestone bonus: ${milestoneBonus} $TAX for user ${ctx.from.id}`);
      }

      console.log(`💰 ${points} $TAX awarded to ${ctx.from.first_name} (${ctx.from.id})`);
      return points;
    } catch (error) {
      console.error('❌ Error processing message points:', error);
      return 0;
    }
  }

  private async calculateMessagePoints(user: IUserDocument, messageText: string, ctx: Context): Promise<number> {
    let points = this.config.baseMessagePoints;

    // Quality bonus based on message length
    const qualityMultiplier = this.getQualityMultiplier(messageText);
    points *= qualityMultiplier;

    // Reply bonus
    if ('reply_to_message' in ctx.message! && ctx.message.reply_to_message) {
      points += this.config.replyBonus;
    }

    // First message of the day bonus
    const isFirstMessageToday = this.isFirstMessageToday(user, ctx.chat!.id);
    if (isFirstMessageToday) {
      points += this.config.dailyFirstMessageBonus;
      await user.updateStreak(); // Update streak for daily activity
    }

    // Streak multiplier
    const streakMultiplier = this.getStreakMultiplier(user.dailyStreak);
    points *= streakMultiplier;

    // Time-based bonuses
    const timeMultiplier = this.getTimeMultiplier();
    points *= timeMultiplier;

    // Diminishing returns for excessive messaging
    const hourlyMessages = await this.getHourlyMessageCount(user, ctx.chat!.id);
    if (hourlyMessages > this.config.diminishingReturnsThreshold) {
      points *= this.config.diminishingReturnsFactor;
    }

    // Round and ensure minimum
    return Math.max(1, Math.round(points));
  }

  private getQualityMultiplier(messageText: string): number {
    if (messageText.length < this.config.minMessageLength) {
      return 0; // No points for very short messages
    }
    
    if (messageText.length >= this.config.qualityMessageLength) {
      return this.config.qualityMultiplier;
    }
    
    return 1; // Base multiplier
  }

  private getStreakMultiplier(streak: number): number {
    let multiplier = 1;
    
    for (const threshold of this.config.streakMultipliers) {
      if (streak >= threshold.days) {
        multiplier = threshold.multiplier;
      } else {
        break;
      }
    }
    
    return Math.min(multiplier, this.config.maxStreakMultiplier);
  }

  private getTimeMultiplier(): number {
    const now = new Date();
    const hour = now.getHours();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    
    let multiplier = 1;
    
    // Weekend bonus
    if (isWeekend) {
      multiplier *= this.config.weekendMultiplier;
    }
    
    // Night owl bonus (late night/early morning)
    const nightOwl = this.config.nightOwlBonus;
    if (hour >= nightOwl.startHour || hour <= nightOwl.endHour) {
      multiplier *= nightOwl.bonus;
    }
    
    return multiplier;
  }

  private canAwardPoints(user: IUserDocument): boolean {
    if (!user.lastPointAward) return true;
    
    const cooldownMs = this.config.cooldownSeconds * 1000;
    const timeSinceLastAward = Date.now() - user.lastPointAward.getTime();
    
    return timeSinceLastAward >= cooldownMs;
  }

  private canAwardDailyPoints(groupActivity: any): boolean {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    // Reset daily points if it's a new day
    if (!groupActivity.lastDailyReset || groupActivity.lastDailyReset < todayStart) {
      groupActivity.dailyPoints = 0;
      groupActivity.lastDailyReset = today;
      return true;
    }
    
    return groupActivity.dailyPoints < this.config.maxPointsPerDay;
  }

  private isFirstMessageToday(user: IUserDocument, groupId: number): boolean {
    const groupActivity = user.groupActivity.find(g => g.groupId === groupId);
    if (!groupActivity?.lastMessageDate) return true;
    
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    return groupActivity.lastMessageDate < todayStart;
  }

  private async getHourlyMessageCount(user: IUserDocument, groupId: number): Promise<number> {
    const groupActivity = user.groupActivity.find(g => g.groupId === groupId);
    if (!groupActivity?.lastMessageDate) return 0;
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Simple approximation - in production, you'd want more sophisticated tracking
    if (groupActivity.lastMessageDate > oneHourAgo) {
      return Math.min(groupActivity.messagesCount, 50); // Cap estimation
    }
    
    return 0;
  }

  private checkMilestone(oldPoints: number, newPoints: number): number {
    for (const milestone of this.config.milestoneRewards) {
      if (oldPoints < milestone.points && newPoints >= milestone.points) {
        return milestone.bonus;
      }
    }
    return 0;
  }

  async getUserStats(userId: number): Promise<{
    taxPoints: number;
    totalEarned: number;
    streak: number;
    messages: number;
    rank?: number;
  } | null> {
    try {
      const user = await User.findOne({ userId });
      if (!user) return null;

      // Calculate rank (expensive operation - consider caching)
      const rank = await User.countDocuments({ taxPoints: { $gt: user.taxPoints } }) + 1;

      return {
        taxPoints: user.taxPoints,
        totalEarned: user.totalPointsEarned,
        streak: user.dailyStreak,
        messages: user.messagesCount,
        rank
      };
    } catch (error) {
      console.error('❌ Error getting user stats:', error);
      return null;
    }
  }

  async getLeaderboard(groupId?: number, limit: number = 10): Promise<Array<{
    userId: number;
    firstName: string;
    taxPoints: number;
    position: number;
  }>> {
    try {
      let users;
      
      if (groupId) {
        // Group-specific leaderboard
        users = await User.find({ 
          groups: groupId,
          isVerified: true,
          'groupActivity.groupId': groupId
        })
        .sort({ 'groupActivity.pointsEarned': -1 })
        .limit(limit);
      } else {
        // Global leaderboard
        users = await User.find({ 
          isVerified: true,
          taxPoints: { $gt: 0 }
        })
        .sort({ taxPoints: -1 })
        .limit(limit);
      }

      return users.map((user, index) => ({
        userId: user.userId,
        firstName: user.firstName,
        taxPoints: groupId 
          ? user.groupActivity.find(g => g.groupId === groupId)?.pointsEarned || 0
          : user.taxPoints,
        position: index + 1
      }));
    } catch (error) {
      console.error('❌ Error getting leaderboard:', error);
      return [];
    }
  }

  // Configuration methods for admin
  updateConfig(newConfig: Partial<PointsConfig>): void {
    Object.assign(this.config, newConfig);
    console.log('⚙️ Tax points configuration updated');
  }

  getConfig(): PointsConfig {
    return { ...this.config };
  }
}