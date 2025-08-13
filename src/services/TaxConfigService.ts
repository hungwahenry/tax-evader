import { TaxConfig, ITaxConfig, ITaxConfigDocument } from '../models/TaxConfig';

export class TaxConfigService {
  private cachedConfig: ITaxConfig | null = null;
  private cacheExpiry: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  
  // Event emitter for real-time updates
  private configChangeListeners: Array<(config: ITaxConfig) => void> = [];

  async getConfig(groupId?: number): Promise<ITaxConfig> {
    try {
      // Check cache first
      if (this.cachedConfig && Date.now() < this.cacheExpiry) {
        return this.applyGroupOverrides(this.cachedConfig, groupId);
      }

      // Load from database
      let config = await TaxConfig.findOne({ isActive: true }).sort({ version: -1 });
      
      if (!config) {
        // Create default configuration if none exists
        console.log('🔧 Creating default $TAX configuration...');
        config = await this.createDefaultConfig() as any;
      }

      if (!config) {
        return (TaxConfig as any).getDefaultConfig();
      }

      // Cache the configuration
      this.cachedConfig = {
        ...config.toObject(),
        _id: undefined,
        __v: undefined,
        createdAt: undefined,
        updatedAt: undefined
      } as ITaxConfig;
      this.cacheExpiry = Date.now() + this.CACHE_DURATION;

      return this.applyGroupOverrides(this.cachedConfig, groupId);
    } catch (error) {
      console.error('❌ Error loading tax configuration:', error);
      // Return default config as fallback
      return (TaxConfig as any).getDefaultConfig();
    }
  }

  async updateConfig(updates: Partial<ITaxConfig>, updatedBy?: number): Promise<ITaxConfig> {
    try {
      // Validate updates
      const validatedUpdates = this.validateConfigUpdates(updates);
      
      // Get current active config
      const currentConfig = await TaxConfig.findOne({ isActive: true }).sort({ version: -1 });
      
      if (!currentConfig) {
        throw new Error('No active configuration found');
      }

      // Create new version with updates
      const newVersion = currentConfig.version + 1;
      const newConfig = await TaxConfig.create({
        ...currentConfig.toObject(),
        ...validatedUpdates,
        version: newVersion,
        lastUpdated: new Date(),
        updatedBy,
        _id: undefined // Remove _id to create new document
      });

      // Deactivate old config
      await TaxConfig.updateMany(
        { _id: { $ne: newConfig._id } },
        { isActive: false }
      );

      // Clear cache and notify listeners
      this.cachedConfig = null;
      const updatedConfig = newConfig.toObject();
      this.notifyConfigChange(updatedConfig);

      console.log(`⚙️ Tax configuration updated to version ${newVersion} by admin ${updatedBy}`);
      return updatedConfig;
    } catch (error) {
      console.error('❌ Error updating tax configuration:', error);
      throw error;
    }
  }

  async updateGroupOverride(groupId: number, overrides: Record<string, any>, updatedBy?: number): Promise<ITaxConfig> {
    try {
      const currentConfig = await this.getConfig();
      
      // Find existing group override or create new one
      const groupOverrides = currentConfig.groupOverrides ? [...currentConfig.groupOverrides] : [];
      const existingOverrideIndex = groupOverrides.findIndex(g => g?.groupId === groupId);
      
      if (existingOverrideIndex >= 0 && groupOverrides[existingOverrideIndex]) {
        // Update existing override
        groupOverrides[existingOverrideIndex]!.overrides = {
          ...groupOverrides[existingOverrideIndex]!.overrides,
          ...overrides
        };
      } else {
        // Add new override
        groupOverrides.push({
          groupId,
          overrides
        });
      }

      return await this.updateConfig({ groupOverrides }, updatedBy);
    } catch (error) {
      console.error('❌ Error updating group override:', error);
      throw error;
    }
  }

  async removeGroupOverride(groupId: number, updatedBy?: number): Promise<ITaxConfig> {
    try {
      const currentConfig = await this.getConfig();
      
      const groupOverrides = (currentConfig.groupOverrides || [])
        .filter(g => g.groupId !== groupId);

      return await this.updateConfig({ groupOverrides }, updatedBy);
    } catch (error) {
      console.error('❌ Error removing group override:', error);
      throw error;
    }
  }

  async getConfigHistory(limit: number = 10): Promise<ITaxConfigDocument[]> {
    try {
      return await TaxConfig.find()
        .sort({ version: -1 })
        .limit(limit);
    } catch (error) {
      console.error('❌ Error fetching config history:', error);
      return [];
    }
  }

  async revertToVersion(version: number, updatedBy?: number): Promise<ITaxConfig> {
    try {
      const targetConfig = await TaxConfig.findOne({ version });
      
      if (!targetConfig) {
        throw new Error(`Configuration version ${version} not found`);
      }

      // Create new config based on target version
      const existingConfigs = await TaxConfig.find().select('version');
      const newVersion = existingConfigs.length > 0 
        ? Math.max(...existingConfigs.map(c => c.version)) + 1
        : 1;
      
      const revertedConfig = await TaxConfig.create({
        ...targetConfig.toObject(),
        version: newVersion,
        lastUpdated: new Date(),
        updatedBy,
        isActive: true,
        _id: undefined
      });

      // Deactivate other configs
      await TaxConfig.updateMany(
        { _id: { $ne: revertedConfig._id } },
        { isActive: false }
      );

      // Clear cache and notify listeners
      this.cachedConfig = null;
      const updatedConfig = revertedConfig.toObject();
      this.notifyConfigChange(updatedConfig);

      console.log(`🔄 Tax configuration reverted to version ${version} (new version ${newVersion})`);
      return updatedConfig;
    } catch (error) {
      console.error('❌ Error reverting configuration:', error);
      throw error;
    }
  }

  // Real-time configuration updates
  onConfigChange(listener: (config: ITaxConfig) => void): void {
    this.configChangeListeners.push(listener);
  }

  private notifyConfigChange(config: ITaxConfig): void {
    this.configChangeListeners.forEach(listener => {
      try {
        listener(config);
      } catch (error) {
        console.error('❌ Error in config change listener:', error);
      }
    });
  }

  private async createDefaultConfig(): Promise<ITaxConfigDocument> {
    const defaultConfig = (TaxConfig as any).getDefaultConfig();
    return await TaxConfig.create(defaultConfig);
  }

  private applyGroupOverrides(config: ITaxConfig, groupId?: number): ITaxConfig {
    if (!groupId || !config.groupOverrides) {
      return config;
    }

    const groupOverride = config.groupOverrides.find(g => g.groupId === groupId);
    if (!groupOverride) {
      return config;
    }

    // Apply overrides
    return {
      ...config,
      ...groupOverride.overrides
    };
  }

  private validateConfigUpdates(updates: Partial<ITaxConfig>): Partial<ITaxConfig> {
    const validated: Partial<ITaxConfig> = {};

    // Validate numeric fields with bounds
    const numericFields = [
      { field: 'welcomeBonus', min: 0, max: 10000 },
      { field: 'baseMessagePoints', min: 0, max: 100 },
      { field: 'dailyFirstMessageBonus', min: 0, max: 1000 },
      { field: 'minMessageLength', min: 1, max: 100 },
      { field: 'qualityMessageLength', min: 1, max: 500 },
      { field: 'qualityMultiplier', min: 1, max: 5 },
      { field: 'replyBonus', min: 0, max: 50 },
      { field: 'maxStreakMultiplier', min: 1, max: 10 },
      { field: 'cooldownSeconds', min: 0, max: 3600 },
      { field: 'maxPointsPerHour', min: 1, max: 10000 },
      { field: 'maxPointsPerDay', min: 1, max: 50000 },
      { field: 'diminishingReturnsThreshold', min: 1, max: 1000 },
      { field: 'diminishingReturnsFactor', min: 0.1, max: 1 },
      { field: 'weekendMultiplier', min: 1, max: 5 },
      { field: 'notificationThreshold', min: 0, max: 1000 }
    ] as const;

    for (const { field, min, max } of numericFields) {
      if (field in updates && typeof updates[field as keyof ITaxConfig] === 'number') {
        const value = updates[field as keyof ITaxConfig] as number;
        if (value >= min && value <= max) {
          (validated as any)[field] = value;
        } else {
          console.warn(`⚠️ Invalid value for ${field}: ${value}. Must be between ${min} and ${max}`);
        }
      }
    }

    // Validate boolean fields
    const booleanFields = [
      'enableWelcomeBonus', 'enableDailyBonus', 'enableStreakMultiplier',
      'enableQualityMultiplier', 'enableTimeMultiplier', 'enableMilestoneRewards',
      'enablePointNotifications', 'enableRankNotifications', 'enableStreakNotifications'
    ] as const;

    for (const field of booleanFields) {
      if (field in updates && typeof updates[field as keyof ITaxConfig] === 'boolean') {
        (validated as any)[field] = updates[field as keyof ITaxConfig];
      }
    }

    // Validate complex objects
    if (updates.nightOwlBonus) {
      const bonus = updates.nightOwlBonus;
      if (bonus.startHour >= 0 && bonus.startHour <= 23 &&
          bonus.endHour >= 0 && bonus.endHour <= 23 &&
          bonus.bonus >= 1 && bonus.bonus <= 5) {
        validated.nightOwlBonus = bonus;
      }
    }

    // Validate arrays
    if (updates.streakMultipliers && Array.isArray(updates.streakMultipliers)) {
      const valid = updates.streakMultipliers.every(sm => 
        sm.days >= 1 && sm.multiplier >= 1 && sm.multiplier <= 10
      );
      if (valid) {
        validated.streakMultipliers = updates.streakMultipliers.sort((a, b) => a.days - b.days);
      }
    }

    if (updates.milestoneRewards && Array.isArray(updates.milestoneRewards)) {
      const valid = updates.milestoneRewards.every(mr => 
        mr.points >= 1 && mr.bonus >= 1
      );
      if (valid) {
        validated.milestoneRewards = updates.milestoneRewards.sort((a, b) => a.points - b.points);
      }
    }

    if (updates.groupOverrides && Array.isArray(updates.groupOverrides)) {
      validated.groupOverrides = updates.groupOverrides;
    }

    return validated;
  }

  // Clear cache manually (useful for testing)
  clearCache(): void {
    this.cachedConfig = null;
    this.cacheExpiry = 0;
  }

  // Get configuration summary for display
  async getConfigSummary(): Promise<string> {
    try {
      const config = await this.getConfig();
      return `🔧 **Tax Configuration v${config.version}**\n\n` +
        `💰 **Rewards:**\n` +
        `• Welcome: ${config.welcomeBonus} $TAX\n` +
        `• Message: ${config.baseMessagePoints} $TAX\n` +
        `• Daily bonus: ${config.dailyFirstMessageBonus} $TAX\n` +
        `• Reply bonus: ${config.replyBonus} $TAX\n\n` +
        `⚡ **Multipliers:**\n` +
        `• Quality: ${config.qualityMultiplier}x (${config.qualityMessageLength}+ chars)\n` +
        `• Weekend: ${config.weekendMultiplier}x\n` +
        `• Max streak: ${config.maxStreakMultiplier}x\n\n` +
        `🛡️ **Limits:**\n` +
        `• Cooldown: ${config.cooldownSeconds}s\n` +
        `• Max/hour: ${config.maxPointsPerHour} $TAX\n` +
        `• Max/day: ${config.maxPointsPerDay} $TAX\n\n` +
        `📊 **Features:**\n` +
        `• Welcome bonus: ${config.enableWelcomeBonus ? '✅' : '❌'}\n` +
        `• Streak multiplier: ${config.enableStreakMultiplier ? '✅' : '❌'}\n` +
        `• Time multiplier: ${config.enableTimeMultiplier ? '✅' : '❌'}\n` +
        `• Notifications: ${config.enablePointNotifications ? '✅' : '❌'}\n\n` +
        `🕐 Last updated: ${config.lastUpdated.toISOString().split('T')[0]}`;
    } catch (error) {
      console.error('❌ Error generating config summary:', error);
      return '❌ Error loading configuration';
    }
  }
}