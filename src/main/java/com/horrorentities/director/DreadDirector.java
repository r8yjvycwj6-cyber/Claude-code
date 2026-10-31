package com.horrorentities.director;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.function.Function;

import com.horrorentities.HorrorConfig;
import com.horrorentities.entity.GauntEntity;
import com.horrorentities.entity.HollowEntity;
import com.horrorentities.entity.HorrorMob;
import com.horrorentities.entity.MimicEntity;
import com.horrorentities.entity.ShadeEntity;
import com.horrorentities.entity.StalkerEntity;
import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.legacyfabric.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.block.Blocks;
import net.minecraft.client.sound.SoundCategory;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.ServerPlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.entity.ItemEntity;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.Sound;
import net.minecraft.sound.Sounds;
import net.minecraft.text.Style;
import net.minecraft.text.Text;
import net.minecraft.text.TranslatableText;
import net.minecraft.util.Formatting;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.World;

/**
 * The thing that makes the dark feel like it is paying attention.
 *
 * <p>Every survival player in the overworld has a <em>dread</em> value (0-100). It climbs at night, in
 * the dark and underground, and falls in daylight and torch light. The higher it is, the more
 * often something happens and the worse that something is: first ambient sounds behind you, then
 * fake chat and snuffed torches, then the entities themselves.
 */
public final class DreadDirector {
	private static final Map<UUID, State> STATES = new HashMap<>();
	private static final List<PendingSound> PENDING = new ArrayList<>();
	private static final Random RANDOM = new Random();
	private static final String[] FAKE_NAMES = {"Herobrine", "Null", "xX_Him_Xx", "???"};
	private static final int WHISPER_COUNT = 8;

	private DreadDirector() {
	}

	private static final class State {
		double dread;
		int cooldownSeconds = 45;
	}

	private static final class PendingSound {
		final UUID player;
		final Sound sound;
		final double x, y, z;
		final float volume, pitch;
		int ticksLeft;

		PendingSound(UUID player, Sound sound, double x, double y, double z, float volume, float pitch, int delay) {
			this.player = player;
			this.sound = sound;
			this.x = x;
			this.y = y;
			this.z = z;
			this.volume = volume;
			this.pitch = pitch;
			this.ticksLeft = delay;
		}
	}

	public static void register() {
		ServerTickEvents.END_SERVER_TICK.register(DreadDirector::onServerTick);
	}

	public static double getDread(PlayerEntity player) {
		State state = STATES.get(player.getUuid());
		return state == null ? 0 : state.dread;
	}

	public static void setDread(PlayerEntity player, double value) {
		state(player).dread = clamp(value);
	}

	public static void addDread(PlayerEntity player, double amount) {
		State state = state(player);
		state.dread = clamp(state.dread + amount);
	}

	private static State state(PlayerEntity player) {
		return STATES.computeIfAbsent(player.getUuid(), id -> new State());
	}

	private static double clamp(double v) {
		return Math.max(0.0, Math.min(100.0, v));
	}

	// ---------------------------------------------------------------- tick

	private static void onServerTick(MinecraftServer server) {
		tickPendingSounds(server);

		if (!HorrorConfig.enableDirector || server.getTicks() % 20 != 0) {
			return;
		}

		ServerWorld world = server.getWorld(0);

		if (world == null) {
			return;
		}

		STATES.keySet().removeIf(id -> world.getPlayerByUuid(id) == null);

		for (PlayerEntity player : new ArrayList<>(world.playerEntities)) {
			if (player instanceof ServerPlayerEntity && !player.isSpectator() && !player.isCreative()) {
				tickPlayer(world, (ServerPlayerEntity) player);
			}
		}
	}

	private static void tickPlayer(ServerWorld world, ServerPlayerEntity player) {
		State state = state(player);
		BlockPos pos = new BlockPos(player.x, player.y + 0.5, player.z);
		int light = world.getLightLevel(pos);
		boolean night = !world.isDay();
		boolean sky = world.hasDirectSunlight(pos);
		boolean dark = light <= 4;
		boolean protectedByCharm = WardingCharmItem.isProtected(player);

		double delta = 0;

		if (night) {
			delta += 0.15;
		}

		if (dark) {
			delta += 0.2;

			if (!sky) {
				delta += 0.1;
			}
		}

		if (!dark && !night && light >= 12) {
			delta -= 0.5;
		} else if (light >= 10) {
			delta -= 0.15;
		}

		if (hasHorrorNearby(world, player, 48)) {
			delta += 0.5;
		}

		delta *= delta > 0 ? HorrorConfig.dreadGainMultiplier : 1.0;

		if (protectedByCharm) {
			delta = delta > 0 ? delta * 0.25 : delta - 0.3;
		}

		state.dread = clamp(state.dread + delta);

		if (--state.cooldownSeconds > 0 || state.dread < 8) {
			return;
		}

		state.cooldownSeconds = nextCooldown(state.dread);
		runEvent(world, player, state.dread, night, dark, sky);
	}

	private static int nextCooldown(double dread) {
		double base = 75.0 - dread * 0.5;
		double jitter = 0.7 + RANDOM.nextDouble() * 0.6;
		return (int) Math.max(10, base * jitter / Math.max(0.1, HorrorConfig.eventFrequency));
	}

	// -------------------------------------------------------------- events

	private static void runEvent(ServerWorld world, ServerPlayerEntity player, double dread, boolean night, boolean dark, boolean sky) {
		boolean cave = dark && !sky;
		boolean spooky = night || cave;
		int crowd = countHorrors(world, player, 96);
		boolean roomForMore = crowd < HorrorConfig.maxEntitiesPerPlayer;

		List<Runnable> pool = new ArrayList<>();
		addWeighted(pool, 6, HorrorConfig.enableAmbientSounds && dread >= 8, () -> ambientEvent(world, player));
		addWeighted(pool, 2, HorrorConfig.enableFakeChat && dread >= 25, () -> chatEvent(player));
		addWeighted(pool, 2, HorrorConfig.enableTorchSnuffing && dread >= 35, () -> snuffTorchEvent(world, player));
		addWeighted(pool, 3, roomForMore && spooky && dread >= 20 && !has(world, player, HollowEntity.class),
				() -> spawnHollow(world, player));
		addWeighted(pool, 4, roomForMore && dark && dread >= 30 && !has(world, player, ShadeEntity.class),
				() -> spawnShade(world, player));
		addWeighted(pool, 3, roomForMore && spooky && dread >= 40 && !has(world, player, StalkerEntity.class),
				() -> spawnStalker(world, player));
		addWeighted(pool, 2, roomForMore && spooky && dread >= 45 && !has(world, player, MimicEntity.class),
				() -> spawnMimic(world, player));
		addWeighted(pool, 2, roomForMore && night && dread >= 55 && !has(world, player, GauntEntity.class),
				() -> spawnGaunt(world, player));

		if (!pool.isEmpty()) {
			pool.get(RANDOM.nextInt(pool.size())).run();
		}
	}

	private static void addWeighted(List<Runnable> pool, int weight, boolean allowed, Runnable action) {
		if (allowed) {
			for (int i = 0; i < weight; i++) {
				pool.add(action);
			}
		}
	}

	/** Something walks up behind you, or a door you never saw creaks open. */
	private static void ambientEvent(ServerWorld world, ServerPlayerEntity player) {
		double behind = Math.toRadians(player.yaw + 180.0 + (RANDOM.nextDouble() - 0.5) * 100.0);
		double dist = 6 + RANDOM.nextDouble() * 8;
		double x = player.x - Math.sin(behind) * dist;
		double z = player.z + Math.cos(behind) * dist;

		switch (RANDOM.nextInt(5)) {
			case 0:
				// Footsteps closing in, then nothing.
				for (int i = 0; i < 5; i++) {
					double d = dist * (1.0 - i * 0.17);
					queue(player, Sounds.BLOCK_GRAVEL_STEP, player.x - Math.sin(behind) * d, player.y, player.z + Math.cos(behind) * d,
							0.9F, 0.7F + RANDOM.nextFloat() * 0.1F, 9 * i);
				}

				break;
			case 1:
				HorrorFx.soundFor(player, Sounds.BLOCK_WOODEN_DOOR_OPEN, x, player.y, z, 0.8F, 0.6F);
				break;
			case 2:
				HorrorFx.soundFor(player, Sounds.AMBIENT_CAVE, x, player.y, z, 1.0F, 0.5F + RANDOM.nextFloat() * 0.4F);
				break;
			case 3:
				HorrorFx.soundFor(player, Sounds.ENTITY_GHAST_AMBIENT, x, player.y + 4, z, 0.6F, 0.4F);
				break;
			default:
				HorrorFx.soundFor(player, Sounds.BLOCK_CHEST_OPEN, x, player.y, z, 0.7F, 0.7F);
				queue(player, Sounds.BLOCK_CHEST_CLOSE, x, player.y, z, 0.7F, 0.7F, 25);
				break;
		}

		addDread(player, 1.0);
	}

	/** Fake chat: someone joins and leaves, or something whispers. */
	private static void chatEvent(ServerPlayerEntity player) {
		if (RANDOM.nextBoolean()) {
			String name = FAKE_NAMES[RANDOM.nextInt(FAKE_NAMES.length)];
			Text joined = new TranslatableText("multiplayer.player.joined", name).setStyle(new Style().setFormatting(Formatting.YELLOW));
			player.sendMessage(joined);
			Text left = new TranslatableText("multiplayer.player.left", name).setStyle(new Style().setFormatting(Formatting.YELLOW));
			scheduleMessage(player, left, 60 + RANDOM.nextInt(80));
		} else {
			Text whisper = new TranslatableText("chat.horrorentities.whisper." + (1 + RANDOM.nextInt(WHISPER_COUNT)))
					.setStyle(new Style().setFormatting(Formatting.GRAY).setItalic(true));
			player.sendMessage(whisper);
		}

		addDread(player, 2.0);
	}

	private static void snuffTorchEvent(ServerWorld world, ServerPlayerEntity player) {
		BlockPos origin = new BlockPos(player.x, player.y, player.z);
		List<BlockPos> torches = new ArrayList<>();
		BlockPos.Mutable cursor = new BlockPos.Mutable();

		for (int dx = -8; dx <= 8; dx++) {
			for (int dy = -3; dy <= 4; dy++) {
				for (int dz = -8; dz <= 8; dz++) {
					cursor.setPosition(origin.getX() + dx, origin.getY() + dy, origin.getZ() + dz);

					if (world.getBlockState(cursor).getBlock() == Blocks.TORCH) {
						torches.add(cursor.toImmutable());
					}
				}
			}
		}

		if (torches.isEmpty()) {
			return;
		}

		BlockPos torch = torches.get(RANDOM.nextInt(torches.size()));
		world.setBlockState(torch, Blocks.AIR.getDefaultState());
		world.spawnEntity(new ItemEntity(world, torch.getX() + 0.5, torch.getY() + 0.5, torch.getZ() + 0.5, new ItemStack(Blocks.TORCH)));
		HorrorFx.soundFor(player, Sounds.BLOCK_FIRE_EXTINGUISH, torch.getX() + 0.5, torch.getY(), torch.getZ() + 0.5, 0.8F, 1.0F);
		addDread(player, 3.0);
	}

	// ------------------------------------------------------------- spawns

	private static void spawnHollow(ServerWorld world, ServerPlayerEntity player) {
		// Somewhere in front of you, in clear view, far away.
		spawn(world, player, HollowEntity::new, 26, 40, true, -1, true);
	}

	private static void spawnStalker(ServerWorld world, ServerPlayerEntity player) {
		spawn(world, player, StalkerEntity::new, 30, 46, false, 16, false);
	}

	private static void spawnMimic(ServerWorld world, ServerPlayerEntity player) {
		spawn(world, player, MimicEntity::new, 16, 24, false, 6, false);
	}

	private static void spawnGaunt(ServerWorld world, ServerPlayerEntity player) {
		spawn(world, player, GauntEntity::new, 22, 32, false, 8, false);
	}

	private static void spawnShade(ServerWorld world, ServerPlayerEntity player) {
		spawn(world, player, ShadeEntity::new, 9, 15, false, 4, false);
	}

	/**
	 * Tries a handful of random spots on a ring around the player.
	 *
	 * @param inFront     restrict the angle to roughly where the player is looking
	 * @param maxLight    spawn only where block light is at or below this (-1 = ignore)
	 * @param needSight   require an unobstructed line from the player's eyes
	 */
	private static void spawn(ServerWorld world, ServerPlayerEntity player, Function<World, ? extends Entity> factory,
			double minDist, double maxDist, boolean inFront, int maxLight, boolean needSight) {
		for (int attempt = 0; attempt < 12; attempt++) {
			double angle = inFront
					? Math.toRadians(player.yaw + (RANDOM.nextDouble() - 0.5) * 70.0)
					: RANDOM.nextDouble() * Math.PI * 2;
			double dist = minDist + RANDOM.nextDouble() * (maxDist - minDist);
			int x = (int) Math.floor(player.x - Math.sin(angle) * dist);
			int z = (int) Math.floor(player.z + Math.cos(angle) * dist);

			if (!SpawnUtil.isLoaded(world, x, z)) {
				continue;
			}

			int y = SpawnUtil.findStandingY(world, x, (int) player.y, z, 10, 3);

			if (y < 0) {
				continue;
			}

			BlockPos feet = new BlockPos(x, y, z);

			if (maxLight >= 0 && world.getLightLevel(feet) > maxLight) {
				continue;
			}

			if (needSight && world.rayTrace(new Vec3d(player.x, player.y + player.getEyeHeight(), player.z),
					new Vec3d(x + 0.5, y + 1.6, z + 0.5)) != null) {
				continue;
			}

			Entity entity = factory.apply(world);
			entity.refreshPositionAndAngles(x + 0.5, y, z + 0.5, (float) Math.toDegrees(Math.atan2(player.x - x, -(player.z - z))), 0.0F);
			world.spawnEntity(entity);
			addDread(player, 2.0);
			return;
		}
	}

	// ------------------------------------------------- command / debug API

	public static final String[] ENTITY_NAMES = {"stalker", "hollow", "mimic", "gaunt", "shade"};
	public static final String[] EVENT_NAMES = {"ambient", "chat", "torch"};

	/** Spawns an entity of the given kind {@code distance} blocks in front of the player, facing them. */
	public static boolean spawnInFront(ServerWorld world, ServerPlayerEntity player, String name, double distance) {
		Function<World, ? extends Entity> factory = factoryFor(name);

		if (factory == null) {
			return false;
		}

		double angle = Math.toRadians(player.yaw);
		int x = (int) Math.floor(player.x - Math.sin(angle) * distance);
		int z = (int) Math.floor(player.z + Math.cos(angle) * distance);
		int y = SpawnUtil.findStandingY(world, x, (int) player.y, z, 8, 3);

		if (y < 0 || !SpawnUtil.isLoaded(world, x, z)) {
			return false;
		}

		Entity entity = factory.apply(world);
		entity.refreshPositionAndAngles(x + 0.5, y, z + 0.5, (float) Math.toDegrees(Math.atan2(player.x - x, -(player.z - z))), 0.0F);
		return world.spawnEntity(entity);
	}

	public static boolean triggerEvent(ServerWorld world, ServerPlayerEntity player, String name) {
		switch (name) {
			case "ambient":
				ambientEvent(world, player);
				return true;
			case "chat":
				chatEvent(player);
				return true;
			case "torch":
				snuffTorchEvent(world, player);
				return true;
			default:
				return false;
		}
	}

	/** Removes every loaded horror entity in the world. Returns how many there were. */
	public static int clearAll(ServerWorld world) {
		int removed = 0;

		for (Entity entity : new ArrayList<>(world.loadedEntities)) {
			if (entity instanceof HorrorMob) {
				entity.remove();
				removed++;
			}
		}

		return removed;
	}

	private static Function<World, ? extends Entity> factoryFor(String name) {
		switch (name) {
			case "stalker":
				return StalkerEntity::new;
			case "hollow":
				return HollowEntity::new;
			case "mimic":
				return MimicEntity::new;
			case "gaunt":
				return GauntEntity::new;
			case "shade":
				return ShadeEntity::new;
			default:
				return null;
		}
	}

	// ------------------------------------------------------------ helpers

	private static boolean hasHorrorNearby(World world, PlayerEntity player, double range) {
		return countHorrors(world, player, range) > 0;
	}

	private static int countHorrors(World world, PlayerEntity player, double range) {
		return world.getEntitiesInBox(Entity.class, player.getBoundingBox().expand(range), e -> e instanceof HorrorMob).size();
	}

	private static boolean has(World world, PlayerEntity player, Class<? extends Entity> type) {
		return !world.getEntitiesInBox(type, player.getBoundingBox().expand(96)).isEmpty();
	}

	private static void queue(PlayerEntity player, Sound sound, double x, double y, double z, float volume, float pitch, int delay) {
		if (delay <= 0) {
			HorrorFx.soundFor(player, sound, x, y, z, volume, pitch);
		} else {
			PENDING.add(new PendingSound(player.getUuid(), sound, x, y, z, volume, pitch, delay));
		}
	}

	private static void scheduleMessage(ServerPlayerEntity player, Text message, int delay) {
		PENDING_MESSAGES.add(new PendingMessage(player.getUuid(), message, delay));
	}

	private static final List<PendingMessage> PENDING_MESSAGES = new ArrayList<>();

	private static final class PendingMessage {
		final UUID player;
		final Text message;
		int ticksLeft;

		PendingMessage(UUID player, Text message, int ticksLeft) {
			this.player = player;
			this.message = message;
			this.ticksLeft = ticksLeft;
		}
	}

	private static void tickPendingSounds(MinecraftServer server) {
		if (PENDING.isEmpty() && PENDING_MESSAGES.isEmpty()) {
			return;
		}

		World world = server.getWorld(0);

		for (Iterator<PendingSound> it = PENDING.iterator(); it.hasNext(); ) {
			PendingSound pending = it.next();

			if (--pending.ticksLeft > 0) {
				continue;
			}

			it.remove();
			PlayerEntity player = world == null ? null : world.getPlayerByUuid(pending.player);

			if (player != null) {
				HorrorFx.soundFor(player, pending.sound, pending.x, pending.y, pending.z, pending.volume, pending.pitch);
			}
		}

		for (Iterator<PendingMessage> it = PENDING_MESSAGES.iterator(); it.hasNext(); ) {
			PendingMessage pending = it.next();

			if (--pending.ticksLeft > 0) {
				continue;
			}

			it.remove();
			PlayerEntity player = world == null ? null : world.getPlayerByUuid(pending.player);

			if (player != null) {
				player.sendMessage(pending.message);
			}
		}
	}
}
