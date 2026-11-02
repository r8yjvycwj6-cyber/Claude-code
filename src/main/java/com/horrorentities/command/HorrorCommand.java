package com.horrorentities.command;

import com.horrorentities.director.StalkerDirector;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.exceptions.SimpleCommandExceptionType;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/** /horror spawn [distance] | clear | status  (operators only). */
public final class HorrorCommand {
	private static final SimpleCommandExceptionType NO_PLAYER =
			new SimpleCommandExceptionType(Component.translatable("commands.horrorentities.horror.no_player"));
	private static final SimpleCommandExceptionType SPAWN_FAILED =
			new SimpleCommandExceptionType(Component.translatable("commands.horrorentities.horror.spawn_failed"));

	private HorrorCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("horror")
				.requires(source -> source.hasPermission(2))
				.then(Commands.literal("spawn")
						.executes(ctx -> spawn(ctx, 14.0))
						.then(Commands.argument("distance", DoubleArgumentType.doubleArg(2, 80))
								.executes(ctx -> spawn(ctx, DoubleArgumentType.getDouble(ctx, "distance")))))
				.then(Commands.literal("clear").executes(HorrorCommand::clear))
				.then(Commands.literal("status").executes(HorrorCommand::status)));
	}

	private static ServerPlayer target(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
		CommandSourceStack source = ctx.getSource();
		ServerPlayer player = source.getPlayer();

		if (player == null) {
			player = source.getServer().getPlayerList().getPlayers().stream().findFirst().orElse(null);
		}

		if (player == null) {
			throw NO_PLAYER.create();
		}

		return player;
	}

	private static int spawn(CommandContext<CommandSourceStack> ctx, double distance) throws CommandSyntaxException {
		ServerPlayer player = target(ctx);

		if (!StalkerDirector.spawnInFront(player.serverLevel(), player, distance)) {
			throw SPAWN_FAILED.create();
		}

		ctx.getSource().sendSuccess(() -> Component.literal("The Stalker is " + distance + " blocks in front of "
				+ player.getGameProfile().getName()), true);
		return 1;
	}

	private static int clear(CommandContext<CommandSourceStack> ctx) {
		int removed = 0;

		for (ServerLevel level : ctx.getSource().getServer().getAllLevels()) {
			removed += StalkerDirector.clearAll(level);
		}

		int count = removed;
		ctx.getSource().sendSuccess(() -> Component.literal("Removed " + count + " Stalker(s)"), true);
		return count;
	}

	private static int status(CommandContext<CommandSourceStack> ctx) {
		String text = StalkerDirector.describe(ctx.getSource().getServer().overworld());
		ctx.getSource().sendSuccess(() -> Component.literal(text), false);
		return 1;
	}
}
