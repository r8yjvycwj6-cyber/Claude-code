package com.horrorentities.director;

import java.util.ArrayList;
import java.util.List;

import com.horrorentities.HorrorConfig;
import com.horrorentities.entity.StalkerEntity;
import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.registry.ModEntities;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.player.Player.BedSleepingProblem;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.event.entity.EntityJoinLevelEvent;
import net.minecraftforge.event.entity.player.PlayerSleepInBedEvent;

/**
 * Decides when the Stalker shows up. From the configured night on (default: the second night) a single
 * Stalker is placed around a random player shortly after dusk, once per night. It is never alive twice
 * in the same world, and nobody can sleep while it is close.
 */
public final class StalkerDirector {
	/** Seconds after nightfall before it shows up. */
	private static final int APPEARANCE_DELAY_SECONDS = 15;
	private static final RandomSource RANDOM = RandomSource.create();

	private static int waitedSeconds;

	private StalkerDirector() {
	}

	// ------------------------------------------------------------------ events

	public static void onServerTick(TickEvent.ServerTickEvent event) {
		if (event.phase == TickEvent.Phase.END && event.getServer().getTickCount() % 20 == 0) {
			tickLevel(event.getServer().overworld(), false);
		}
	}

	/** Only one Stalker may exist: a second one trying to enter the world is refused. */
	public static void onEntityJoin(EntityJoinLevelEvent event) {
		if (event.getLevel().isClientSide() || !(event.getEntity() instanceof StalkerEntity newcomer) || !(event.getLevel() instanceof ServerLevel level)) {
			return;
		}

		for (Entity other : level.getAllEntities()) {
			if (other != newcomer && other instanceof StalkerEntity && !other.isRemoved()) {
				event.setCanceled(true);
				return;
			}
		}
	}

	/** No sleeping with the Stalker nearby, unless the player is holding a Warding Charm. */
	public static void onSleep(PlayerSleepInBedEvent event) {
		Player player = event.getEntity();

		if (player.level().isClientSide || WardingCharmItem.isProtected(player)) {
			return;
		}

		double range = HorrorConfig.SLEEP_BLOCK_RANGE.get();

		if (!player.level().getEntitiesOfClass(StalkerEntity.class, player.getBoundingBox().inflate(range)).isEmpty()) {
			event.setResult(BedSleepingProblem.OTHER_PROBLEM);
			player.displayClientMessage(Component.translatable("message.horrorentities.cannot_sleep"), true);
		}
	}

	// ---------------------------------------------------------------- schedule

	/**
	 * One director step for a level (called once a second).
	 *
	 * @param immediate skip the short delay after nightfall (used by tests)
	 */
	public static void tickLevel(ServerLevel level, boolean immediate) {
		long day = level.getDayTime() / 24000L;
		List<ServerPlayer> players = survivalPlayers(level);
		HauntData data = HauntData.get(level);

		boolean due = !level.isDay()
				&& day >= HorrorConfig.FIRST_NIGHT.get() - 1
				&& data.lastSpawnDay() < day
				&& !players.isEmpty()
				&& !exists(level);

		if (!due) {
			waitedSeconds = 0;
			return;
		}

		if (!immediate && ++waitedSeconds < APPEARANCE_DELAY_SECONDS) {
			return;
		}

		ServerPlayer target = players.get(RANDOM.nextInt(players.size()));

		if (spawnAround(level, target, 24.0, 34.0, true)) {
			data.markSpawned(day);
			waitedSeconds = 0;
		}
	}

	private static List<ServerPlayer> survivalPlayers(ServerLevel level) {
		List<ServerPlayer> result = new ArrayList<>();

		for (ServerPlayer player : level.players()) {
			if (!player.isSpectator() && !player.isCreative()) {
				result.add(player);
			}
		}

		return result;
	}

	public static void resetForTests(ServerLevel level) {
		HauntData.get(level).reset();
		waitedSeconds = 0;
	}

	// ------------------------------------------------------------------ spawns

	public static boolean exists(ServerLevel level) {
		return count(level) > 0;
	}

	public static int count(ServerLevel level) {
		int count = 0;

		for (Entity entity : level.getAllEntities()) {
			if (entity instanceof StalkerEntity && !entity.isRemoved()) {
				count++;
			}
		}

		return count;
	}

	/** Places the Stalker on a random ring around the player. */
	private static boolean spawnAround(ServerLevel level, ServerPlayer player, double minDist, double maxDist, boolean fadesAtDawn) {
		for (int attempt = 0; attempt < 16; attempt++) {
			double angle = RANDOM.nextDouble() * Math.PI * 2;
			double dist = minDist + RANDOM.nextDouble() * (maxDist - minDist);
			int x = (int) Math.floor(player.getX() - Math.sin(angle) * dist);
			int z = (int) Math.floor(player.getZ() + Math.cos(angle) * dist);

			if (!SpawnUtil.isLoaded(level, x, z)) {
				continue;
			}

			int y = SpawnUtil.findStandingY(level, x, (int) player.getY(), z, 10, 3);

			if (y != Integer.MIN_VALUE && place(level, x + 0.5, y, z + 0.5, player, fadesAtDawn)) {
				return true;
			}
		}

		return false;
	}

	private static boolean place(ServerLevel level, double x, double y, double z, Player facing, boolean fadesAtDawn) {
		StalkerEntity stalker = ModEntities.STALKER.get().create(level);

		if (stalker == null) {
			return false;
		}

		// Minecraft yaw 0 faces +Z; a direction (dx, dz) has yaw atan2(-dx, dz).
		float yaw = (float) Math.toDegrees(Math.atan2(-(facing.getX() - x), facing.getZ() - z));
		stalker.moveTo(x, y, z, yaw, 0.0F);
		stalker.setFadesAtDawn(fadesAtDawn);
		return level.addFreshEntity(stalker);
	}

	/** Command/debug: spawn it {@code distance} blocks in front of the player. Refused while one already exists. */
	public static boolean spawnInFront(ServerLevel level, ServerPlayer player, double distance) {
		if (exists(level)) {
			return false;
		}

		double angle = Math.toRadians(player.getYRot());
		int x = (int) Math.floor(player.getX() - Math.sin(angle) * distance);
		int z = (int) Math.floor(player.getZ() + Math.cos(angle) * distance);
		int y = SpawnUtil.findStandingY(level, x, (int) player.getY(), z, 8, 3);

		if (y == Integer.MIN_VALUE || !SpawnUtil.isLoaded(level, x, z)) {
			return false;
		}

		return place(level, x + 0.5, y, z + 0.5, player, false);
	}

	/** Removes the Stalker from the level. Returns how many were removed. */
	public static int clearAll(ServerLevel level) {
		List<Entity> all = new ArrayList<>();
		level.getAllEntities().forEach(all::add);
		int removed = 0;

		for (Entity entity : all) {
			if (entity instanceof StalkerEntity) {
				entity.discard();
				removed++;
			}
		}

		return removed;
	}

	/** For /horror status. */
	public static String describe(ServerLevel level) {
		long day = level.getDayTime() / 24000L;
		return "day " + (day + 1) + ", " + (level.isDay() ? "daytime" : "night")
				+ ", stalkers alive: " + count(level)
				+ ", first night: " + HorrorConfig.FIRST_NIGHT.get()
				+ ", last haunted day: " + (HauntData.get(level).lastSpawnDay() + 1);
	}
}
