package com.horrorentities;

import java.util.Collections;
import java.util.List;
import java.util.Locale;

import com.horrorentities.director.DreadDirector;

import net.minecraft.command.AbstractCommand;
import net.minecraft.command.CommandException;
import net.minecraft.command.CommandSource;
import net.minecraft.entity.player.ServerPlayerEntity;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.LiteralText;
import net.minecraft.util.math.BlockPos;

/** /horror dread [value] | spawn &lt;entity&gt; [distance] | event &lt;kind&gt; | clear  (operators only). */
public class HorrorCommand extends AbstractCommand {
	@Override
	public String getCommandName() {
		return "horror";
	}

	@Override
	public int getPermissionLevel() {
		return 2;
	}

	@Override
	public String getUsageTranslationKey(CommandSource source) {
		return "commands.horrorentities.horror.usage";
	}

	@Override
	public void method_3279(MinecraftServer server, CommandSource sender, String[] args) throws CommandException {
		if (args.length == 0) {
			throw new CommandException("commands.horrorentities.horror.usage");
		}

		ServerWorld world = server.getWorld(0);
		ServerPlayerEntity player = sender.getEntity() instanceof ServerPlayerEntity
				? (ServerPlayerEntity) sender.getEntity()
				: firstPlayer(server);

		switch (args[0].toLowerCase(Locale.ROOT)) {
			case "dread":
				requirePlayer(player);

				if (args.length > 1) {
					DreadDirector.setDread(player, parseDouble(args[1]));
				}

				say(sender, String.format(Locale.ROOT, "%s: dread %.1f / 100", player.getName().computeValue(), DreadDirector.getDread(player)));
				return;
			case "spawn":
				requirePlayer(player);

				if (args.length < 2) {
					throw new CommandException("commands.horrorentities.horror.usage");
				}

				double distance = args.length > 2 ? parseDouble(args[2]) : 14.0;

				if (!DreadDirector.spawnInFront(world, player, args[1].toLowerCase(Locale.ROOT), distance)) {
					throw new CommandException("commands.horrorentities.horror.spawn_failed");
				}

				say(sender, "Spawned " + args[1] + " " + distance + " blocks in front of " + player.getName().computeValue());
				return;
			case "event":
				requirePlayer(player);

				if (args.length < 2 || !DreadDirector.triggerEvent(world, player, args[1].toLowerCase(Locale.ROOT))) {
					throw new CommandException("commands.horrorentities.horror.usage");
				}

				say(sender, "Triggered event " + args[1]);
				return;
			case "clear":
				say(sender, "Removed " + DreadDirector.clearAll(world) + " horror entities");
				return;
			default:
				throw new CommandException("commands.horrorentities.horror.usage");
		}
	}

	private static ServerPlayerEntity firstPlayer(MinecraftServer server) {
		List<ServerPlayerEntity> players = server.getPlayerManager().getPlayers();
		return players.isEmpty() ? null : players.get(0);
	}

	private static void requirePlayer(ServerPlayerEntity player) throws CommandException {
		if (player == null) {
			throw new CommandException("commands.horrorentities.horror.no_player");
		}
	}

	private static void say(CommandSource sender, String message) {
		sender.sendMessage(new LiteralText(message));
	}

	@Override
	public List<String> method_10738(MinecraftServer server, CommandSource sender, String[] args, BlockPos pos) {
		if (args.length == 1) {
			return method_2894(args, "dread", "spawn", "event", "clear");
		}

		if (args.length == 2 && args[0].equalsIgnoreCase("spawn")) {
			return method_2894(args, DreadDirector.ENTITY_NAMES);
		}

		if (args.length == 2 && args[0].equalsIgnoreCase("event")) {
			return method_2894(args, DreadDirector.EVENT_NAMES);
		}

		return Collections.emptyList();
	}
}
