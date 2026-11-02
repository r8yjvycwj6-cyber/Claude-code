package com.horrorentities.gametest;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.horrorentities.HorrorEntities;
import com.horrorentities.director.StalkerDirector;
import com.horrorentities.entity.StalkerEntity;
import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.registry.ModEntities;
import com.horrorentities.registry.ModItems;

import com.mojang.authlib.GameProfile;

import io.netty.channel.embedded.EmbeddedChannel;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.entity.player.PlayerSleepInBedEvent;
import net.minecraftforge.gametest.GameTestHolder;

/**
 * Development-only behaviour tests: run with {@code ./gradlew runGameTestServer}.
 * They are excluded from the shipped jar.
 */
@GameTestHolder(HorrorEntities.MOD_ID)
public class HorrorGameTests {
	private static final String EMPTY = "forge:empty3x3x3";
	private static final String TESTER_NAME = "HorrorTester";
	private static final List<ChunkPos> FORCED = new ArrayList<>();

	/**
	 * A survival-mode fake player standing at (x, 2, z) and facing +Z (yaw 0).
	 * (The helper's own mock server player reports isCreative() = true, which the Stalker rightly ignores.)
	 * Also clears leftovers of earlier tests so neighbouring tests cannot see each other.
	 */
	private static ServerPlayer player(GameTestHelper helper, double x, double z) {
		ServerLevel level = helper.getLevel();
		purge(level);
		CommonListenerCookie cookie = CommonListenerCookie.createInitial(new GameProfile(UUID.randomUUID(), TESTER_NAME), false);
		ServerPlayer player = new ServerPlayer(level.getServer(), level, cookie.gameProfile(), cookie.clientInformation()) {
			@Override
			public boolean isSpectator() {
				return false;
			}

			@Override
			public boolean isCreative() {
				return false;
			}
		};
		buildFloor(helper);
		Vec3 at = helper.absoluteVec(new Vec3(x, 2, z));
		player.moveTo(at.x, at.y, at.z, 0.0F, 0.0F);
		face(player, 0.0F);

		Connection connection = new Connection(PacketFlow.SERVERBOUND);
		new EmbeddedChannel(connection);
		level.getServer().getPlayerList().placeNewPlayer(connection, player, cookie);
		player.setGameMode(GameType.SURVIVAL);
		player.moveTo(at.x, at.y, at.z, 0.0F, 0.0F);
		face(player, 0.0F);
		level.getChunkSource().move(player);
		return player;
	}

	/** Turns a player; line of sight uses the head rotation, so it has to be set too. */
	private static void face(ServerPlayer player, float yaw) {
		player.setYRot(yaw);
		player.setYHeadRot(yaw);
		player.setXRot(0.0F);
		player.yRotO = yaw;
		player.xRotO = 0.0F;
	}

	/**
	 * The template is only 3x3x3 and the world ground is at a different height, so lay a flat stone
	 * floor (top surface at relative y=2) big enough for everything the tests place around the player.
	 */
	private static void buildFloor(GameTestHelper helper) {
		forceLoadArea(helper);

		for (int x = -14; x <= 18; x++) {
			for (int z = -14; z <= 28; z++) {
				for (int y = 1; y <= 8; y++) {
					helper.setBlock(new BlockPos(x, y, z), y == 1 ? Blocks.STONE : Blocks.AIR);
				}
			}
		}
	}

	/**
	 * GameTest only keeps the template's own chunks entity-ticking; anything placed further out would
	 * tick or not depending on where the random test origin falls. Force the whole play area instead.
	 */
	private static void forceLoadArea(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		BlockPos min = helper.absolutePos(new BlockPos(-48, 0, -48));
		BlockPos max = helper.absolutePos(new BlockPos(52, 0, 60));

		for (int cx = min.getX() >> 4; cx <= max.getX() >> 4; cx++) {
			for (int cz = min.getZ() >> 4; cz <= max.getZ() >> 4; cz++) {
				level.setChunkForced(cx, cz, true);
				FORCED.add(new ChunkPos(cx, cz));
			}
		}
	}

	private static void purge(ServerLevel level) {
		for (ChunkPos chunk : FORCED) {
			level.setChunkForced(chunk.x, chunk.z, false);
		}

		FORCED.clear();

		for (ServerPlayer other : new ArrayList<>(level.players())) {
			if (TESTER_NAME.equals(other.getGameProfile().getName())) {
				level.getServer().getPlayerList().remove(other);
			}
		}

		StalkerDirector.clearAll(level);
		StalkerDirector.resetForTests(level);
	}

	private static double horizontalDistance(Entity a, Entity b) {
		return Math.hypot(a.getX() - b.getX(), a.getZ() - b.getZ());
	}

	// ------------------------------------------------------------------ behaviour

	@GameTest(batch = "frozenWhenWatched", template = EMPTY, timeoutTicks = 320)
	public static void stalkerFreezesWhenWatchedAndMovesWhenNot(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 9.5));
		double startX = stalker.getX();
		double startZ = stalker.getZ();

		helper.runAfterDelay(50, () -> {
			helper.assertTrue(Math.hypot(stalker.getX() - startX, stalker.getZ() - startZ) < 0.5, "stalker moved while watched");
			helper.assertTrue(stalker.isNoAi(), "stalker should have NoAI while watched");
			face(player, 180.0F); // look away
		});

		helper.runAfterDelay(250, () -> {
			helper.assertTrue(Math.hypot(stalker.getX() - startX, stalker.getZ() - startZ) > 1.0, "stalker never moved once unobserved");
			helper.succeed();
		});
	}

	@GameTest(batch = "noAttackWhenWatched", template = EMPTY, timeoutTicks = 200)
	public static void stalkerCannotAttackWhileWatched(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 3.5));
		stalker.setAttackCooldown(0);
		float health = player.getHealth();

		helper.runAfterDelay(80, () -> {
			helper.assertTrue(player.getHealth() == health, "player was hurt by a watched stalker");
			helper.succeed();
		});
	}

	@GameTest(batch = "strikeThenRetreat", template = EMPTY, timeoutTicks = 300)
	public static void stalkerStrikesOnceThenSlipsAway(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		face(player, 180.0F); // looking away
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 6.5));
		stalker.setAttackCooldown(0);
		float health = player.getHealth();

		helper.succeedWhen(() -> {
			helper.assertTrue(player.getHealth() < health, "stalker should have hurt the player");
			helper.assertTrue(!stalker.isRemoved() && stalker.isAlive(), "stalker should survive its strike");
			helper.assertTrue(!stalker.isAttackReady(), "strike should start a cooldown");
			helper.assertTrue(horizontalDistance(stalker, player) > 15.0, "stalker should slip away after striking");
		});
	}

	@GameTest(batch = "lurks", template = EMPTY, timeoutTicks = 500)
	public static void stalkerLurksAroundAnUnobservedPlayerWithoutAttacking(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		face(player, 180.0F);
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 17.5));
		float health = player.getHealth();
		double[] closest = {Double.MAX_VALUE};
		double[] travelled = {0.0};
		double[] last = {stalker.getX(), stalker.getZ()};

		helper.onEachTick(() -> {
			closest[0] = Math.min(closest[0], horizontalDistance(stalker, player));
			travelled[0] += Math.hypot(stalker.getX() - last[0], stalker.getZ() - last[1]);
			last[0] = stalker.getX();
			last[1] = stalker.getZ();
		});

		helper.runAfterDelay(450, () -> {
			helper.assertTrue(player.getHealth() == health, "stalker attacked during its grace period");
			helper.assertTrue(closest[0] > 8.0, "stalker came too close while lurking: " + closest[0]);
			helper.assertTrue(horizontalDistance(stalker, player) < 28.0, "stalker lost the player");
			helper.assertTrue(travelled[0] > 6.0, "stalker barely moved around the player: " + travelled[0]);
			helper.succeed();
		});
	}

	// -------------------------------------------------------------------- one only

	@GameTest(batch = "onlyOne", template = EMPTY, timeoutTicks = 60)
	public static void onlyOneStalkerCanExist(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		ServerPlayer player = player(helper, 1.5, 1.5);

		helper.assertTrue(StalkerDirector.spawnInFront(level, player, 8.0), "first stalker should spawn");
		helper.assertTrue(!StalkerDirector.spawnInFront(level, player, 12.0), "second stalker must be refused");

		helper.spawn(ModEntities.STALKER.get(), new Vec3(4.5, 2, 4.5)); // e.g. /summon: the join is cancelled
		helper.runAfterDelay(5, () -> {
			helper.assertTrue(StalkerDirector.count(level) == 1, "expected exactly one stalker, found " + StalkerDirector.count(level));
			helper.succeed();
		});
	}

	// ------------------------------------------------------------------ hard to kill

	@GameTest(batch = "damageCap", template = EMPTY, timeoutTicks = 60)
	public static void singleHitsAreCappedAndTheStalkerIsArmoured(GameTestHelper helper) {
		purge(helper.getLevel());
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 1.5));
		float before = stalker.getHealth();

		stalker.hurt(stalker.damageSources().generic(), 1000.0F);
		float lost = before - stalker.getHealth();
		helper.assertTrue(lost > 0.0F, "the stalker took no damage at all");
		helper.assertTrue(lost <= 8.0F, "one hit removed " + lost + " health, expected at most 8");
		helper.assertTrue(stalker.isAlive(), "a single huge hit should not kill it");
		helper.succeed();
	}

	@GameTest(batch = "regen", template = EMPTY, timeoutTicks = 400)
	public static void stalkerRegeneratesAndStillDiesToTheKillCommand(GameTestHelper helper) {
		purge(helper.getLevel());
		buildFloor(helper); // keeps the whole area ticking even if it blinks away from the hit
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 1.5));
		stalker.setHealth(60.0F);
		stalker.hurt(stalker.damageSources().generic(), 1.0F);
		float afterHit = stalker.getHealth();

		helper.runAfterDelay(300, () -> {
			helper.assertTrue(stalker.getHealth() > afterHit + 4.0F, "no regeneration: " + afterHit + " -> " + stalker.getHealth());
			stalker.kill();
			helper.assertTrue(!stalker.isAlive(), "kill should still work");
			helper.succeed();
		});
	}

	@GameTest(batch = "drops", template = EMPTY, timeoutTicks = 60)
	public static void killedStalkerDropsNightmareShards(GameTestHelper helper) {
		purge(helper.getLevel());
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 1.5));
		stalker.kill();

		helper.runAfterDelay(5, () -> {
			int shards = 0;

			for (ItemEntity drop : helper.getLevel().getEntitiesOfClass(ItemEntity.class,
					new net.minecraft.world.phys.AABB(helper.absolutePos(new BlockPos(1, 2, 1))).inflate(6.0),
					e -> e.getItem().is(ModItems.NIGHTMARE_SHARD.get()))) {
				shards += drop.getItem().getCount();
			}

			helper.assertTrue(shards >= 3, "expected at least 3 shards, got " + shards);
			helper.succeed();
		});
	}

	// --------------------------------------------------------------------- sleeping

	@GameTest(batch = "sleep", template = EMPTY, timeoutTicks = 60)
	public static void nobodySleepsNearTheStalkerUnlessProtected(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		BlockPos bed = helper.absolutePos(new BlockPos(1, 2, 1));

		helper.assertTrue(sleepResult(player, bed) == null, "sleeping should be allowed when no stalker is around");

		helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 20.5)); // far from a bed, but within 32 blocks
		helper.assertTrue(sleepResult(player, bed) != null, "sleeping should be blocked with the stalker within 32 blocks");

		player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(ModItems.WARDING_CHARM.get()));
		helper.assertTrue(sleepResult(player, bed) == null, "a held warding charm should allow sleeping");
		helper.succeed();
	}

	private static Object sleepResult(ServerPlayer player, BlockPos bed) {
		PlayerSleepInBedEvent event = new PlayerSleepInBedEvent(player, Optional.of(bed));
		MinecraftForge.EVENT_BUS.post(event);
		return event.getResultStatus();
	}

	// ---------------------------------------------------------------------- charm

	@GameTest(batch = "charm", template = EMPTY, timeoutTicks = 260)
	public static void wardingCharmMakesTheStalkerIgnoreYou(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		face(player, 180.0F);
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 8.5));
		stalker.setAttackCooldown(0);
		player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(ModItems.WARDING_CHARM.get()));
		helper.assertTrue(WardingCharmItem.isProtected(player), "charm in hand should protect");
		float health = player.getHealth();

		helper.runAfterDelay(200, () -> {
			helper.assertTrue(stalker.getTarget() == null, "stalker targeted a ward holder");
			helper.assertTrue(player.getHealth() == health, "ward holder was attacked");
			helper.succeed();
		});
	}

	// ------------------------------------------------------------------- the schedule

	@GameTest(batch = "night2", template = EMPTY, timeoutTicks = 100)
	public static void stalkerAppearsOnTheSecondNightOnlyAndOncePerNight(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		player(helper, 1.5, 1.5);

		level.setDayTime(14000L); // first night
		helper.runAfterDelay(3, () -> {
			StalkerDirector.tickLevel(level, true);
			helper.assertTrue(StalkerDirector.count(level) == 0, "stalker must not appear on the first night");

			level.setDayTime(24000L + 14000L); // second night
		});

		helper.runAfterDelay(8, () -> {
			StalkerDirector.tickLevel(level, true);
			helper.assertTrue(StalkerDirector.count(level) == 1, "stalker should appear on the second night");

			StalkerDirector.clearAll(level); // killed: it must not come back the same night
			StalkerDirector.tickLevel(level, true);
			helper.assertTrue(StalkerDirector.count(level) == 0, "stalker returned within the same night");

			level.setDayTime(2 * 24000L + 14000L); // third night
		});

		helper.runAfterDelay(14, () -> {
			StalkerDirector.tickLevel(level, true);
			helper.assertTrue(StalkerDirector.count(level) == 1, "stalker should return on the next night");
			helper.succeed();
		});
	}

	@GameTest(batch = "dawn", template = EMPTY, timeoutTicks = 100)
	public static void directorStalkerFadesAtDawn(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		player(helper, 1.5, 1.5);
		level.setDayTime(24000L + 14000L);

		helper.runAfterDelay(4, () -> {
			StalkerDirector.tickLevel(level, true);
			helper.assertTrue(StalkerDirector.count(level) == 1, "stalker should have appeared");
			level.setDayTime(2 * 24000L + 1000L); // morning
		});

		helper.runAfterDelay(20, () -> {
			helper.assertTrue(StalkerDirector.count(level) == 0, "stalker should fade at dawn");
			helper.succeed();
		});
	}

	@GameTest(batch = "facing", template = EMPTY, timeoutTicks = 60)
	public static void commandSpawnedStalkerFacesThePlayer(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		ServerPlayer player = player(helper, 1.5, 1.5); // facing +Z, so the stalker appears south of the player
		helper.assertTrue(StalkerDirector.spawnInFront(level, player, 6.0), "could not spawn");

		StalkerEntity stalker = level.getEntitiesOfClass(StalkerEntity.class, player.getBoundingBox().inflate(10.0)).get(0);
		float off = Math.abs(net.minecraft.util.Mth.wrapDegrees(stalker.getYRot() - 180.0F));
		helper.assertTrue(off < 5.0F, "stalker should face the player (yaw 180) but has yaw " + stalker.getYRot());
		helper.succeed();
	}

	@GameTest(batch = "recipes", template = EMPTY)
	public static void recipesAreLoaded(GameTestHelper helper) {
		var manager = helper.getLevel().getServer().getRecipeManager();
		helper.assertTrue(manager.byKey(ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, "warding_charm")).isPresent(),
				"warding_charm recipe missing");
		helper.assertTrue(manager.byKey(ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, "greater_warding_charm")).isPresent(),
				"greater_warding_charm recipe missing");
		helper.succeed();
	}
}
