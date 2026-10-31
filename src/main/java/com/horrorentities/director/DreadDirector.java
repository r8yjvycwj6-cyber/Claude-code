package com.horrorentities.director;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;

import com.horrorentities.HorrorConfig;
import com.horrorentities.entity.GauntEntity;
import com.horrorentities.entity.HollowEntity;
import com.horrorentities.entity.HorrorMob;
import com.horrorentities.entity.MimicEntity;
import com.horrorentities.entity.ShadeEntity;
import com.horrorentities.entity.StalkerEntity;
import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.registry.ModEntities;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.ClipContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.HitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.event.TickEvent;

/**
 * The thing that makes the dark feel like it is paying attention.
 *
 * <p>Every survival player in the overworld has a <em>dread</em> value (0-100). It climbs at night, in
 * the dark and underground, and falls in daylight and torch light. The higher it is, the more
 * often something happens and the worse that something is: first ambient sounds behind you, then
 * fake chat and snuffed torches, then the entities themselves.
 */
public final class DreadDirector {
	public static final String[] ENTITY_NAMES = {"stalker", "hollow", "mimic", "gaunt", "shade"};
	public static final String[] EVENT_NAMES = {"ambient", "chat", "torch"};

	private static final Map<UUID, State> STATES = new HashMap<>();
	private static final List<PendingSound> PENDING_SOUNDS = new ArrayList<>();
	private static final List<PendingMessage> PENDING_MESSAGES = new ArrayList<>();
	private static final RandomSource RANDOM = RandomSource.create();
	private static final String[] FAKE_NAMES = {"Herobrine", "Null", "xX_Him_Xx", "???"};
	private static final int WHISPER_COUNT = 8;

	private DreadDirector() {
	}

	private static final class State {
		double dread;
		int cooldownSeconds = 45;
	}

	private record PendingSound(UUID player, SoundEvent sound, double x, double y, double z, float volume, float pitch, int[] ticksLeft) {
	}

	private record PendingMessage(UUID player, Component message, int[] ticksLeft) {
	}

	// ---------------------------------------------------------------- dread

	public static double getDread(Player player) {
		State state = STATES.get(player.getUUID());
		return state == null ? 0 : state.dread;
	}

	public static void setDread(Player player, double value) {
		state(player).dread = clamp(value);
	}

	public static void addDread(Player player, double amount) {
		State state = state(player);
		state.dread = clamp(state.dread + amount);
	}

	private static State state(Player player) {
		return STATES.computeIfAbsent(player.getUUID(), id -> new State());
	}

	private static double clamp(double v) {
		return Math.max(0.0, Math.min(100.0, v));
	}

	// ----------------------------------------------------------------- tick

	public static void onServerTick(TickEvent.ServerTickEvent event) {
		if (event.phase != TickEvent.Phase.END) {
			return;
		}

		MinecraftServer server = event.getServer();
		tickPending(server);

		if (!HorrorConfig.ENABLE_DIRECTOR.get() || server.getTickCount() % 20 != 0) {
			return;
		}

		ServerLevel level = server.overworld();
		STATES.keySet().removeIf(id -> server.getPlayerList().getPlayer(id) == null);

		for (ServerPlayer player : new ArrayList<>(level.players())) {
			if (!player.isSpectator() && !player.isCreative()) {
				tickPlayer(level, player);
			}
		}
	}

	private static void tickPlayer(ServerLevel level, ServerPlayer player) {
		State state = state(player);
		BlockPos pos = BlockPos.containing(player.getX(), player.getY() + 0.5, player.getZ());
		int light = level.getMaxLocalRawBrightness(pos);
		boolean night = !level.isDay();
		boolean sky = level.canSeeSky(pos);
		boolean dark = light <= 4;

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

		if (countHorrors(level, player, 48) > 0) {
			delta += 0.5;
		}

		if (delta > 0) {
			delta *= HorrorConfig.DREAD_GAIN_MULTIPLIER.get();
		}

		if (WardingCharmItem.isProtected(player)) {
			delta = delta > 0 ? delta * 0.25 : delta - 0.3;
		}

		state.dread = clamp(state.dread + delta);

		if (--state.cooldownSeconds > 0 || state.dread < 8) {
			return;
		}

		state.cooldownSeconds = nextCooldown(state.dread);
		runEvent(level, player, state.dread, night, dark, sky);
	}

	private static int nextCooldown(double dread) {
		double base = 75.0 - dread * 0.5;
		double jitter = 0.7 + RANDOM.nextDouble() * 0.6;
		return (int) Math.max(10, base * jitter / Math.max(0.1, HorrorConfig.EVENT_FREQUENCY.get()));
	}

	// --------------------------------------------------------------- events

	private static void runEvent(ServerLevel level, ServerPlayer player, double dread, boolean night, boolean dark, boolean sky) {
		boolean cave = dark && !sky;
		boolean spooky = night || cave;
		boolean roomForMore = countHorrors(level, player, 96) < HorrorConfig.MAX_ENTITIES_PER_PLAYER.get();

		List<Runnable> pool = new ArrayList<>();
		addWeighted(pool, 6, HorrorConfig.ENABLE_AMBIENT_SOUNDS.get() && dread >= 8, () -> ambientEvent(player));
		addWeighted(pool, 2, HorrorConfig.ENABLE_FAKE_CHAT.get() && dread >= 25, () -> chatEvent(player));
		addWeighted(pool, 2, HorrorConfig.ENABLE_TORCH_SNUFFING.get() && dread >= 35, () -> snuffTorchEvent(level, player));
		addWeighted(pool, 3, roomForMore && spooky && dread >= 20 && !has(level, player, HollowEntity.class),
				() -> spawnNear(level, player, ModEntities.HOLLOW.get(), 26, 40, true, -1, true));
		addWeighted(pool, 4, roomForMore && dark && dread >= 30 && !has(level, player, ShadeEntity.class),
				() -> spawnNear(level, player, ModEntities.SHADE.get(), 9, 15, false, 4, false));
		addWeighted(pool, 3, roomForMore && spooky && dread >= 40 && !has(level, player, StalkerEntity.class),
				() -> spawnNear(level, player, ModEntities.STALKER.get(), 30, 46, false, 16, false));
		addWeighted(pool, 2, roomForMore && spooky && dread >= 45 && !has(level, player, MimicEntity.class),
				() -> spawnNear(level, player, ModEntities.MIMIC.get(), 16, 24, false, 6, false));
		addWeighted(pool, 2, roomForMore && night && dread >= 55 && !has(level, player, GauntEntity.class),
				() -> spawnNear(level, player, ModEntities.GAUNT.get(), 22, 32, false, 8, false));

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
	private static void ambientEvent(ServerPlayer player) {
		double behind = Math.toRadians(player.getYRot() + 180.0 + (RANDOM.nextDouble() - 0.5) * 100.0);
		double dist = 6 + RANDOM.nextDouble() * 8;
		double x = player.getX() - Math.sin(behind) * dist;
		double z = player.getZ() + Math.cos(behind) * dist;

		switch (RANDOM.nextInt(5)) {
			case 0 -> {
				// Footsteps closing in, then nothing.
				for (int i = 0; i < 5; i++) {
					double d = dist * (1.0 - i * 0.17);
					queueSound(player, SoundEvents.GRAVEL_STEP, player.getX() - Math.sin(behind) * d, player.getY(),
							player.getZ() + Math.cos(behind) * d, 0.9F, 0.7F + RANDOM.nextFloat() * 0.1F, 9 * i);
				}
			}
			case 1 -> HorrorFx.soundFor(player, SoundEvents.WOODEN_DOOR_OPEN, x, player.getY(), z, 0.8F, 0.6F);
			case 2 -> HorrorFx.soundFor(player, SoundEvents.AMBIENT_CAVE, x, player.getY(), z, 1.0F, 0.5F + RANDOM.nextFloat() * 0.4F);
			case 3 -> HorrorFx.soundFor(player, SoundEvents.GHAST_AMBIENT, x, player.getY() + 4, z, 0.6F, 0.4F);
			default -> {
				HorrorFx.soundFor(player, SoundEvents.CHEST_OPEN, x, player.getY(), z, 0.7F, 0.7F);
				queueSound(player, SoundEvents.CHEST_CLOSE, x, player.getY(), z, 0.7F, 0.7F, 25);
			}
		}

		addDread(player, 1.0);
	}

	/** Fake chat: someone joins and leaves, or something whispers. */
	private static void chatEvent(ServerPlayer player) {
		if (RANDOM.nextBoolean()) {
			String name = FAKE_NAMES[RANDOM.nextInt(FAKE_NAMES.length)];
			player.sendSystemMessage(Component.translatable("multiplayer.player.joined", name).withStyle(ChatFormatting.YELLOW));
			PENDING_MESSAGES.add(new PendingMessage(player.getUUID(),
					Component.translatable("multiplayer.player.left", name).withStyle(ChatFormatting.YELLOW),
					new int[] {60 + RANDOM.nextInt(80)}));
		} else {
			player.sendSystemMessage(Component.translatable("chat.horrorentities.whisper." + (1 + RANDOM.nextInt(WHISPER_COUNT)))
					.withStyle(ChatFormatting.GRAY, ChatFormatting.ITALIC));
		}

		addDread(player, 2.0);
	}

	private static void snuffTorchEvent(ServerLevel level, ServerPlayer player) {
		BlockPos origin = player.blockPosition();
		List<BlockPos> torches = new ArrayList<>();
		BlockPos.MutableBlockPos cursor = new BlockPos.MutableBlockPos();

		for (int dx = -8; dx <= 8; dx++) {
			for (int dy = -3; dy <= 4; dy++) {
				for (int dz = -8; dz <= 8; dz++) {
					cursor.set(origin.getX() + dx, origin.getY() + dy, origin.getZ() + dz);
					BlockState state = level.getBlockState(cursor);

					if (state.is(Blocks.TORCH) || state.is(Blocks.WALL_TORCH)) {
						torches.add(cursor.immutable());
					}
				}
			}
		}

		if (torches.isEmpty()) {
			return;
		}

		BlockPos torch = torches.get(RANDOM.nextInt(torches.size()));
		level.destroyBlock(torch, true);
		HorrorFx.soundFor(player, SoundEvents.FIRE_EXTINGUISH, torch.getX() + 0.5, torch.getY(), torch.getZ() + 0.5, 0.8F, 1.0F);
		addDread(player, 3.0);
	}

	// --------------------------------------------------------------- spawns

	/**
	 * Tries a handful of random spots on a ring around the player.
	 *
	 * @param inFront   restrict the angle to roughly where the player is looking
	 * @param maxLight  spawn only where light is at or below this (-1 = ignore)
	 * @param needSight require an unobstructed line from the player's eyes
	 */
	private static boolean spawnNear(ServerLevel level, ServerPlayer player, EntityType<?> type,
			double minDist, double maxDist, boolean inFront, int maxLight, boolean needSight) {
		for (int attempt = 0; attempt < 12; attempt++) {
			double angle = inFront
					? Math.toRadians(player.getYRot() + (RANDOM.nextDouble() - 0.5) * 70.0)
					: RANDOM.nextDouble() * Math.PI * 2;
			double dist = minDist + RANDOM.nextDouble() * (maxDist - minDist);
			int x = (int) Math.floor(player.getX() - Math.sin(angle) * dist);
			int z = (int) Math.floor(player.getZ() + Math.cos(angle) * dist);

			if (!SpawnUtil.isLoaded(level, x, z)) {
				continue;
			}

			int y = SpawnUtil.findStandingY(level, x, (int) player.getY(), z, 10, 3);

			if (y == Integer.MIN_VALUE) {
				continue;
			}

			BlockPos feet = new BlockPos(x, y, z);

			if (maxLight >= 0 && level.getMaxLocalRawBrightness(feet) > maxLight) {
				continue;
			}

			if (needSight) {
				Vec3 eyes = player.getEyePosition();
				Vec3 target = new Vec3(x + 0.5, y + 1.6, z + 0.5);

				if (level.clip(new ClipContext(eyes, target, ClipContext.Block.COLLIDER, ClipContext.Fluid.NONE, player)).getType() != HitResult.Type.MISS) {
					continue;
				}
			}

			if (place(level, type, x + 0.5, y, z + 0.5, player)) {
				addDread(player, 2.0);
				return true;
			}
		}

		return false;
	}

	private static boolean place(ServerLevel level, EntityType<?> type, double x, double y, double z, Player facing) {
		Entity entity = type.create(level);

		if (entity == null) {
			return false;
		}

		float yaw = (float) Math.toDegrees(Math.atan2(facing.getX() - x, -(facing.getZ() - z)));
		entity.moveTo(x, y, z, yaw, 0.0F);
		return level.addFreshEntity(entity);
	}

	// ------------------------------------------------- command / debug API

	/** Spawns an entity of the given kind {@code distance} blocks in front of the player, facing them. */
	public static boolean spawnInFront(ServerLevel level, ServerPlayer player, String name, double distance) {
		var type = ModEntities.byName(name);

		if (type == null) {
			return false;
		}

		double angle = Math.toRadians(player.getYRot());
		int x = (int) Math.floor(player.getX() - Math.sin(angle) * distance);
		int z = (int) Math.floor(player.getZ() + Math.cos(angle) * distance);
		int y = SpawnUtil.findStandingY(level, x, (int) player.getY(), z, 8, 3);

		if (y == Integer.MIN_VALUE || !SpawnUtil.isLoaded(level, x, z)) {
			return false;
		}

		return place(level, type.get(), x + 0.5, y, z + 0.5, player);
	}

	public static boolean triggerEvent(ServerLevel level, ServerPlayer player, String name) {
		switch (name) {
			case "ambient" -> ambientEvent(player);
			case "chat" -> chatEvent(player);
			case "torch" -> snuffTorchEvent(level, player);
			default -> {
				return false;
			}
		}

		return true;
	}

	/** Removes every loaded horror entity in the world. Returns how many there were. */
	public static int clearAll(ServerLevel level) {
		int removed = 0;

		for (Entity entity : level.getAllEntities()) {
			if (entity instanceof HorrorMob) {
				entity.discard();
				removed++;
			}
		}

		return removed;
	}

	// -------------------------------------------------------------- helpers

	private static int countHorrors(Level level, Player player, double range) {
		return level.getEntitiesOfClass(Entity.class, player.getBoundingBox().inflate(range), e -> e instanceof HorrorMob).size();
	}

	private static boolean has(Level level, Player player, Class<? extends Entity> type) {
		return !level.getEntitiesOfClass(type, player.getBoundingBox().inflate(96)).isEmpty();
	}

	private static void queueSound(Player player, SoundEvent sound, double x, double y, double z, float volume, float pitch, int delay) {
		if (delay <= 0) {
			HorrorFx.soundFor(player, sound, x, y, z, volume, pitch);
		} else {
			PENDING_SOUNDS.add(new PendingSound(player.getUUID(), sound, x, y, z, volume, pitch, new int[] {delay}));
		}
	}

	private static void tickPending(MinecraftServer server) {
		if (PENDING_SOUNDS.isEmpty() && PENDING_MESSAGES.isEmpty()) {
			return;
		}

		for (Iterator<PendingSound> it = PENDING_SOUNDS.iterator(); it.hasNext(); ) {
			PendingSound pending = it.next();

			if (--pending.ticksLeft()[0] > 0) {
				continue;
			}

			it.remove();
			ServerPlayer player = server.getPlayerList().getPlayer(pending.player());

			if (player != null) {
				HorrorFx.soundFor(player, pending.sound(), pending.x(), pending.y(), pending.z(), pending.volume(), pending.pitch());
			}
		}

		for (Iterator<PendingMessage> it = PENDING_MESSAGES.iterator(); it.hasNext(); ) {
			PendingMessage pending = it.next();

			if (--pending.ticksLeft()[0] > 0) {
				continue;
			}

			it.remove();
			ServerPlayer player = server.getPlayerList().getPlayer(pending.player());

			if (player != null) {
				player.sendSystemMessage(pending.message());
			}
		}
	}
}
