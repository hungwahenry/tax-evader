import { Context } from 'telegraf';
import { User } from '../models/User';
import { VerificationSession } from '../models/VerificationSession';
import { TaxPointsService } from './TaxPointsService';

export class VerificationService {
  private readonly VERIFICATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private pendingJoinMessages = new Map<string, number>();
  private taxPointsService = new TaxPointsService();

  async handleNewUser(ctx: Context, member: any): Promise<void> {
    try {
      if (!ctx.chat) return;

      // Store user info
      await User.findOneAndUpdate(
        { userId: member.id },
        {
          userId: member.id,
          username: member.username,
          firstName: member.first_name,
          lastName: member.last_name,
          $addToSet: { groups: ctx.chat.id }
        },
        { upsert: true, new: true }
      );

      // Restrict user permissions - they can't send messages until verified
      await ctx.telegram.restrictChatMember(ctx.chat.id, member.id, {
        permissions: {
          can_send_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false
        }
      });

      // Generate verification deep link
      const botUsername = process.env.BOT_USERNAME;
      const verificationToken = `${member.id}_${ctx.chat.id}_${Date.now()}`;
      const encodedToken = Buffer.from(verificationToken).toString('base64');
      const deepLink = `https://t.me/${botUsername}?start=verify_${encodedToken}`;

      // Send welcome message with verification button
      const welcomeMessage = `👋 Welcome ${member.first_name}!\n\n🔒 Please click the button below to verify yourself and gain access to the chat.`;
      
      const sentMessage = await ctx.reply(welcomeMessage, {
        reply_markup: {
          inline_keyboard: [[
            {
              text: '✅ Verify',
              url: deepLink
            }
          ]]
        }
      });

      // Store verification session
      const expiresAt = new Date(Date.now() + this.VERIFICATION_TIMEOUT);
      await VerificationSession.create({
        userId: member.id,
        groupId: ctx.chat.id,
        verificationCode: verificationToken,
        isCompleted: false,
        expiresAt,
        messageId: sentMessage.message_id
      });

      // Store join message for cleanup
      if ('new_chat_members' in ctx.message!) {
        const joinMessageKey = `${member.id}_${ctx.chat.id}`;
        this.pendingJoinMessages.set(joinMessageKey, ctx.message!.message_id);
      }

      // Set timeout to remove user if not verified
      setTimeout(async () => {
        await this.handleVerificationTimeout(ctx.chat!.id, member.id, ctx.telegram);
      }, this.VERIFICATION_TIMEOUT);

      console.log(`🔗 Verification required for ${member.first_name} (${member.id})`);
    } catch (error) {
      console.error('❌ Error handling new user:', error);
    }
  }

  async handleVerificationStart(ctx: Context): Promise<void> {
    try {
      if (!('text' in ctx.message!)) return;
      
      const args = ctx.message.text.split(' ');
      if (args.length < 2) {
        await ctx.reply('👋 Hello! Use the verification button from your group to complete verification.');
        return;
      }

      const command = args[1];
      if (command && command.startsWith('verify_')) {
        const encodedToken = command.replace('verify_', '');
        await this.processVerification(ctx, encodedToken);
      } else {
        await ctx.reply('👋 Hello! Use the verification button from your group to complete verification.');
      }
    } catch (error) {
      console.error('❌ Error in verification start:', error);
      await ctx.reply('❌ Verification failed. Please try again.');
    }
  }

  async handleMessage(ctx: Context): Promise<void> {
    try {
      if (!ctx.from || !ctx.chat) return;

      // Check if user is verified and clean up join messages
      const user = await User.findOne({ userId: ctx.from.id, isVerified: true });
      if (user) {
        const joinMessageKey = `${ctx.from.id}_${ctx.chat.id}`;
        const joinMessageId = this.pendingJoinMessages.get(joinMessageKey);
        
        if (joinMessageId) {
          try {
            await ctx.telegram.deleteMessage(ctx.chat.id, joinMessageId);
            this.pendingJoinMessages.delete(joinMessageKey);
          } catch (error) {
            // Message might already be deleted
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  private async processVerification(ctx: Context, encodedToken: string): Promise<void> {
    try {
      if (!encodedToken) {
        await ctx.reply('❌ Invalid verification link.');
        return;
      }

      // Decode token
      let decodedToken: string;
      try {
        decodedToken = Buffer.from(encodedToken, 'base64').toString('utf8');
      } catch (error) {
        await ctx.reply('❌ Invalid verification link.');
        return;
      }

      const parts = decodedToken.split('_');
      if (parts.length < 3) {
        await ctx.reply('❌ Invalid verification link.');
        return;
      }

      const userId = parseInt(parts[0] || '');
      const groupId = parseInt(parts[1] || '');

      if (isNaN(userId) || isNaN(groupId) || ctx.from?.id !== userId) {
        await ctx.reply('❌ This verification link is not for you.');
        return;
      }

      // Find verification session
      const session = await VerificationSession.findOne({
        userId,
        groupId,
        verificationCode: decodedToken,
        isCompleted: false
      });

      if (!session || session.expiresAt < new Date()) {
        await ctx.reply('❌ Invalid or expired verification link. Please rejoin the group.');
        return;
      }

      // Complete verification
      session.isCompleted = true;
      await session.save();

      // Restore user permissions
      await ctx.telegram.restrictChatMember(groupId, userId, {
        permissions: {
          can_send_messages: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false
        }
      });

      // Mark user as verified
      await User.updateOne(
        { userId },
        { 
          isVerified: true, 
          verificationDate: new Date() 
        }
      );

      // Award welcome bonus points
      const welcomePoints = await this.taxPointsService.awardWelcomeBonus(userId);

      // Update verification message in group
      try {
        if (session.messageId) {
          await ctx.telegram.editMessageText(
            groupId,
            session.messageId,
            undefined,
            `✅ ${ctx.from.first_name} verified successfully!`
          );
        }
      } catch (error) {
        // Message might be deleted
      }

      await ctx.reply(`✅ Verification complete! You now have access to the group chat.\n\n💰 Welcome bonus: +${welcomePoints} $TAX points!`);
      console.log(`✅ User ${userId} verified successfully with ${welcomePoints} welcome bonus`);
    } catch (error) {
      console.error('❌ Error in verification process:', error);
      await ctx.reply('❌ Verification failed. Please try again.');
    }
  }

  private async handleVerificationTimeout(groupId: number, userId: number, telegram: any): Promise<void> {
    try {
      const session = await VerificationSession.findOne({
        userId,
        groupId,
        isCompleted: false
      });

      if (session) {
        // Remove user from group
        await telegram.banChatMember(groupId, userId);
        await telegram.unbanChatMember(groupId, userId);

        // Delete verification message
        try {
          if (session.messageId) {
            await telegram.deleteMessage(groupId, session.messageId);
          }
        } catch (error) {
          // Message might already be deleted
        }

        // Mark session as completed
        session.isCompleted = true;
        await session.save();

        // Clean up pending join message
        const joinMessageKey = `${userId}_${groupId}`;
        this.pendingJoinMessages.delete(joinMessageKey);

        console.log(`⏰ User ${userId} verification timed out`);
      }
    } catch (error) {
      console.error('❌ Error handling verification timeout:', error);
    }
  }
}