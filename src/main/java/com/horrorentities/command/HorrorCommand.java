package com.horrorentities.command;

import java.util.Locale;

import com.horrorentities.director.DreadDirector;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.DoubleArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.exceptions.SimpleCommandExceptionType;

import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;

/** /horror dread [value] | spawn &lt;entity&gt; [distance] | event &lt;kind&gt; | clear  (operators only). */
public final class HorrorCommand {
	private static final SimpleCommandExceptionType NO_PLAYER =
			new SimpleCommandExceptionType(Component.translatable("commands.horrorentities.horror.no_player"));
	private static final SimpleCommandExceptionType SPAWN_FAILED =
			new SimpleCommandExceptionType(Component.translatable("commands.horrorentities.horror.spawn_failed"));
	private static final SimpleCommandExceptionType BAD_ARGUMENT =
			new SimpleCommandExceptionType(Component.translatable("commands.horrorentities.horror.usage"));

	private HorrorCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("horror")
				.requires(source -> source.hasPermission(2))
				.then(Commands.literal("dread")
						.executes(ctx -> dread(ctx, null))
						.then(Commands.argument("value", DoubleArgumentType.doubleArg(0, 100))
								.executes(ctx -> dread(ctx, DoubleArgumentType.getDouble(ctx, "value")))))
				.then(Commands.literal("spawn")
						.then(Commands.argument("entity", StringArgumentType.word())
								.suggests((ctx, builder) -> SharedSuggestionProvider.suggest(DreadDirector.ENTITY_NAMES, builder))
								.executes(ctx -> spawn(ctx, 14.0))
								.then(Commands.argument("distance", DoubleArgumentType.doubleArg(2, 80))
										.executes(ctx -> spawn(ctx, DoubleArgumentType.getDouble(ctx, "distance"))))))
				.then(Commands.literal("event")
						.then(Commands.argument("kind", StringArgumentType.word())
								.suggests((ctx, builder) -> SharedSuggestionProvider.suggest(DreadDirector.EVENT_NAMES, builder))
								.executes(HorrorCommand::event)))
				.then(Commands.literal("clear").executes(HorrorCommand::clear)));
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

	private static int dread(CommandContext<CommandSourceStack> ctx, Double value) throws CommandSyntaxException {
		ServerPlayer player = target(ctx);

		if (value != null) {
			DreadDirector.setDread(player, value);
		}

		double now = DreadDirector.getDread(player);
		ctx.getSource().sendSuccess(() -> Component.literal(String.format(Locale.ROOT, "%s: dread %.1f / 100",
				player.getGameProfile().getName(), now)), false);
		return (int) now;
	}

	private static int spawn(CommandContext<CommandSourceStack> ctx, double distance) throws CommandSyntaxException {
		ServerPlayer player = target(ctx);
		String name = StringArgumentType.getString(ctx, "entity").toLowerCase(Locale.ROOT);
		ServerLevel level = player.serverLevel();

		if (!DreadDirector.spawnInFront(level, player, name, distance)) {
			throw SPAWN_FAILED.create();
		}

		ctx.getSource().sendSuccess(() -> Component.literal("Spawned " + name + " " + distance + " blocks in front of "
				+ player.getGameProfile().getName()), true);
		return 1;
	}

	private static int event(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
		ServerPlayer player = target(ctx);
		String kind = StringArgumentType.getString(ctx, "kind").toLowerCase(Locale.ROOT);

		if (!DreadDirector.triggerEvent(player.serverLevel(), player, kind)) {
			throw BAD_ARGUMENT.create();
		}

		ctx.getSource().sendSuccess(() -> Component.literal("Triggered event " + kind), true);
		return 1;
	}

	private static int clear(CommandContext<CommandSourceStack> ctx) {
		int removed = 0;

		for (ServerLevel level : ctx.getSource().getServer().getAllLevels()) {
			removed += DreadDirector.clearAll(level);
		}

		int count = removed;
		ctx.getSource().sendSuccess(() -> Component.literal("Removed " + count + " horror entities"), true);
		return count;
	}
}
