import { Context } from 'telegraf';
import { User, IUserDocument } from '../models/User';
import { TaxConfigService } from './TaxConfigService';
import { ITaxConfig } from '../models/TaxConfig';

export class TaxPointsService {
  private configService = new TaxConfigService();

  constructor() {
    // Subscribe to configuration changes for real-time updates
    this.configService.onConfigChange((config) => {
      console.log(`🔄 Tax points configuration updated to version ${config.version}`);
    });
  }

  async awardWelcomeBonus(userId: number): Promise<number> {
    try {
      const user = await User.findOne({ userId });
      if (!user) return 0;

      const config = await this.configService.getConfig();
      
      if (!config.enableWelcomeBonus) {
        console.log(`⚠️ Welcome bonus disabled for user ${userId}`);
        return 0;
      }

      const points = config.welcomeBonus;
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

      const config = await this.configService.getConfig(ctx.chat.id);

      // Check cooldown
      if (!this.canAwardPoints(user, config)) {
        return 0;
      }

      // Check daily limits
      const groupActivity = user.groupActivity.find(g => g.groupId === ctx.chat!.id);
      if (groupActivity && !this.canAwardDailyPoints(groupActivity, config)) {
        return 0;
      }

      // Calculate base points
      let points = await this.calculateMessagePoints(user, messageText, ctx, config);
      
      if (points <= 0) return 0;

      // Award points
      await user.awardPoints(points, ctx.chat.id);
      await user.incrementMessages(ctx.chat.id);

      // Check for milestones
      if (config.enableMilestoneRewards) {
        const milestoneBonus = this.checkMilestone(user.taxPoints - points, user.taxPoints, config);
        if (milestoneBonus > 0) {
          await user.awardPoints(milestoneBonus);
          console.log(`🏆 Milestone bonus: ${milestoneBonus} $TAX for user ${ctx.from.id}`);
        }
      }

      console.log(`💰 ${points} $TAX awarded to ${ctx.from.first_name} (${ctx.from.id})`);
      return points;
    } catch (error) {
      console.error('❌ Error processing message points:', error);
      return 0;
    }
  }

  private async calculateMessagePoints(user: IUserDocument, messageText: string, ctx: Context, config: ITaxConfig): Promise<number> {
    let points = config.baseMessagePoints;

    // Quality bonus based on message length
    if (config.enableQualityMultiplier) {
      const qualityMultiplier = this.getQualityMultiplier(messageText, config);
      points *= qualityMultiplier;
    }

    // Reply bonus
    if ('reply_to_message' in ctx.message! && ctx.message.reply_to_message) {
      points += config.replyBonus;
    }

    // First message of the day bonus
    const isFirstMessageToday = this.isFirstMessageToday(user, ctx.chat!.id);
    if (isFirstMessageToday && config.enableDailyBonus) {
      points += config.dailyFirstMessageBonus;
      await user.updateStreak(); // Update streak for daily activity
    }

    // Streak multiplier
    if (config.enableStreakMultiplier) {
      const streakMultiplier = this.getStreakMultiplier(user.dailyStreak, config);
      points *= streakMultiplier;
    }

    // Time-based bonuses
    if (config.enableTimeMultiplier) {
      const timeMultiplier = this.getTimeMultiplier(config);
      points *= timeMultiplier;
    }

    // Diminishing returns for excessive messaging
    const hourlyMessages = await this.getHourlyMessageCount(user, ctx.chat!.id);
    if (hourlyMessages > config.diminishingReturnsThreshold) {
      points *= config.diminishingReturnsFactor;
    }

    // Round and ensure minimum
    return Math.max(1, Math.round(points));
  }

  private getQualityMultiplier(messageText: string, config: ITaxConfig): number {
    if (messageText.length < config.minMessageLength) {
      return 0; // No points for very short messages
    }
    
    if (messageText.length >= config.qualityMessageLength) {
      return config.qualityMultiplier;
    }
    
    return 1; // Base multiplier
  }

  private getStreakMultiplier(streak: number, config: ITaxConfig): number {
    let multiplier = 1;
    
    for (const threshold of config.streakMultipliers) {
      if (streak >= threshold.days) {
        multiplier = threshold.multiplier;
      } else {
        break;
      }
    }
    
    return Math.min(multiplier, config.maxStreakMultiplier);
  }

  private getTimeMultiplier(config: ITaxConfig): number {
    const now = new Date();
    const hour = now.getHours();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    
    let multiplier = 1;
    
    // Weekend bonus
    if (isWeekend) {
      multiplier *= config.weekendMultiplier;
    }
    
    // Night owl bonus (late night/early morning)
    const nightOwl = config.nightOwlBonus;
    if (hour >= nightOwl.startHour || hour <= nightOwl.endHour) {
      multiplier *= nightOwl.bonus;
    }
    
    return multiplier;
  }

  private canAwardPoints(user: IUserDocument, config: ITaxConfig): boolean {
    if (!user.lastPointAward) return true;
    
    const cooldownMs = config.cooldownSeconds * 1000;
    const timeSinceLastAward = Date.now() - user.lastPointAward.getTime();
    
    return timeSinceLastAward >= cooldownMs;
  }

  private canAwardDailyPoints(groupActivity: any, config: ITaxConfig): boolean {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    // Reset daily points if it's a new day
    if (!groupActivity.lastDailyReset || groupActivity.lastDailyReset < todayStart) {
      groupActivity.dailyPoints = 0;
      groupActivity.lastDailyReset = today;
      return true;
    }
    
    return groupActivity.dailyPoints < config.maxPointsPerDay;
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

  private checkMilestone(oldPoints: number, newPoints: number, config: ITaxConfig): number {
    for (const milestone of config.milestoneRewards) {
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

  // Get current configuration for display
  async getCurrentConfig(groupId?: number): Promise<ITaxConfig> {
    return await this.configService.getConfig(groupId);
  }

  // Get configuration summary
  async getConfigSummary(): Promise<string> {
    return await this.configService.getConfigSummary();
  }

  // Clear configuration cache (useful for testing)
  clearConfigCache(): void {
    this.configService.clearCache();
  }
}