import { Telegraf, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { VerificationService } from './services/VerificationService';
import { TaxPointsService } from './services/TaxPointsService';

dotenv.config();

class SimpleVerificationBot {
  private bot: Telegraf<Context>;
  private verificationService: VerificationService;
  private taxPointsService: TaxPointsService;

  constructor() {
    const token = process.env.BOT_TOKEN;
    const botUsername = process.env.BOT_USERNAME;

    if (!token) {
      console.error('❌ BOT_TOKEN is required');
      process.exit(1);
    }

    if (!botUsername) {
      console.error('❌ BOT_USERNAME is required for deep links');
      process.exit(1);
    }

    this.bot = new Telegraf<Context>(token);
    this.verificationService = new VerificationService();
    this.taxPointsService = new TaxPointsService();
    this.setupBot();
    this.setupErrorHandling();
  }

  private setupBot(): void {
    // Handle new members joining
    this.bot.on(message('new_chat_members'), async (ctx) => {
      try {
        const newMembers = ctx.message.new_chat_members;
        for (const member of newMembers) {
          if (!member.is_bot) {
            console.log(`👋 New member: ${member.first_name} (${member.id})`);
            await this.verificationService.handleNewUser(ctx, member);
          }
        }
      } catch (error) {
        console.error('❌ Error handling new member:', error);
      }
    });

    // Handle /start command for verification
    this.bot.start(async (ctx) => {
      try {
        await this.verificationService.handleVerificationStart(ctx);
      } catch (error) {
        console.error('❌ Error in start command:', error);
        await ctx.reply('❌ Verification failed. Please try again.');
      }
    });

    // Handle messages to clean up join messages and award points
    this.bot.on(message('text'), async (ctx) => {
      try {
        // Skip commands
        if (ctx.message.text.startsWith('/')) {
          return;
        }

        // Clean up join messages after verification
        await this.verificationService.handleMessage(ctx);

        // Award points for messages
        const pointsAwarded = await this.taxPointsService.processMessagePoints(ctx, ctx.message.text);
        
        // Optionally send feedback for significant point awards (can be disabled)
        if (pointsAwarded >= 10) {
          // Only notify for significant point awards to avoid spam
          const stats = await this.taxPointsService.getUserStats(ctx.from.id);
          if (stats) {
            await ctx.reply(`💰 +${pointsAwarded} $TAX points! Total: ${stats.taxPoints} $TAX (Rank #${stats.rank})`, {
              reply_parameters: { message_id: ctx.message.message_id }
            });
          }
        }
      } catch (error) {
        console.error('❌ Error handling message:', error);
      }
    });
  }

  private setupErrorHandling(): void {
    this.bot.catch((err) => {
      console.error('❌ Bot error:', err);
    });

    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      this.shutdown();
    });

    process.on('unhandledRejection', (reason) => {
      console.error('❌ Unhandled Rejection:', reason);
    });
  }

  private async connectDatabase(): Promise<void> {
    try {
      const mongoUri = process.env.MONGODB_URI;
      if (!mongoUri) {
        throw new Error('MONGODB_URI is required');
      }

      await mongoose.connect(mongoUri);
      console.log('✅ Connected to MongoDB');
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      process.exit(1);
    }
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Simple Verification Bot...');
      
      await this.connectDatabase();
      
      const botInfo = await this.bot.telegram.getMe();
      console.log(`🤖 Bot @${botInfo.username} starting...`);

      await this.bot.launch();
      console.log('✅ Bot is running!');
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  private shutdown(): void {
    console.log('🛑 Shutting down...');
    this.bot.stop('SIGTERM');
    mongoose.connection.close();
    process.exit(0);
  }
}

// Create and start the bot
const bot = new SimpleVerificationBot();

async function main() {
  try {
    await bot.start();

    // Handle shutdown signals
    process.once('SIGINT', () => process.exit(0));
    process.once('SIGTERM', () => process.exit(0));

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();