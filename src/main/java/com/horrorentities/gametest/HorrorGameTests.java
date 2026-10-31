package com.horrorentities.gametest;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.horrorentities.HorrorEntities;
import com.horrorentities.director.DreadDirector;
import com.horrorentities.entity.GauntEntity;
import com.horrorentities.entity.HollowEntity;
import com.horrorentities.entity.MimicEntity;
import com.horrorentities.entity.ShadeEntity;
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
	 * (The helper's own mock server player reports isCreative() = true, which horrors rightly ignore.)
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
		BlockPos min = helper.absolutePos(new BlockPos(-20, 0, -20));
		BlockPos max = helper.absolutePos(new BlockPos(24, 0, 34));

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

		DreadDirector.clearAll(level);
	}

	private static double horizontalDistance(Entity a, Entity b) {
		return Math.hypot(a.getX() - b.getX(), a.getZ() - b.getZ());
	}

	@GameTest(batch = "stalkerFreezesWhenWatchedAndAdvancesWhen", template = EMPTY, timeoutTicks = 200)
	public static void stalkerFreezesWhenWatchedAndAdvancesWhenNot(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 9.5));
		double start = horizontalDistance(stalker, player);

		helper.runAfterDelay(50, () -> {
			double watched = horizontalDistance(stalker, player);
			helper.assertTrue(Math.abs(watched - start) < 0.5, "stalker moved while watched: " + start + " -> " + watched);
			helper.assertTrue(stalker.isNoAi(), "stalker should have NoAI while watched");

			face(player, 180.0F); // look away
		});

		helper.runAfterDelay(140, () -> {
			double unwatched = horizontalDistance(stalker, player);
			helper.assertTrue(unwatched < start - 1.5, "stalker did not approach when unwatched: " + start + " -> " + unwatched);
			helper.succeed();
		});
	}

	@GameTest(batch = "stalkerCannotAttackWhileWatched", template = EMPTY, timeoutTicks = 200)
	public static void stalkerCannotAttackWhileWatched(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 3.5));
		float health = player.getHealth();

		helper.runAfterDelay(80, () -> {
			helper.assertTrue(player.getHealth() == health, "player was hurt by a watched stalker");
			helper.succeed();
		});
	}

	@GameTest(batch = "stalkerStrikesOnceThenVanishes", template = EMPTY, timeoutTicks = 200)
	public static void stalkerStrikesOnceThenVanishes(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		face(player, 180.0F); // looking away
		StalkerEntity stalker = helper.spawn(ModEntities.STALKER.get(), new Vec3(1.5, 2, 6.5));
		float health = player.getHealth();

		helper.succeedWhen(() -> {
			helper.assertTrue(stalker.isRemoved(), "stalker should vanish after striking");
			helper.assertTrue(player.getHealth() < health, "stalker should have hurt the player first");
		});
	}

	@GameTest(batch = "hollowVanishesWhenWatched", template = EMPTY, timeoutTicks = 160)
	public static void hollowVanishesWhenWatched(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 0.5);
		HollowEntity hollow = helper.spawn(ModEntities.HOLLOW.get(), new Vec3(1.5, 2, 14.5));
		helper.assertTrue(horizontalDistance(hollow, player) > 12.0, "test setup: hollow must start beyond 12 blocks");

		helper.succeedWhen(() -> helper.assertTrue(hollow.isRemoved(), "hollow should vanish after being watched"));
	}

	@GameTest(batch = "hollowSurvivesWhenNotWatchedAndIsInvulne", template = EMPTY, timeoutTicks = 160)
	public static void hollowSurvivesWhenNotWatchedAndIsInvulnerable(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 0.5);
		face(player, 180.0F); // facing away
		HollowEntity hollow = helper.spawn(ModEntities.HOLLOW.get(), new Vec3(1.5, 2, 14.5));

		helper.runAfterDelay(20, () -> {
			boolean hurt = hollow.hurt(hollow.damageSources().generic(), 100.0F);
			helper.assertTrue(!hurt, "hollow reported taking damage");
		});

		helper.runAfterDelay(80, () -> {
			helper.assertTrue(!hollow.isRemoved() && hollow.isAlive(), "hollow should still be there");
			helper.assertTrue(hollow.getHealth() == hollow.getMaxHealth(), "hollow lost health");
			helper.succeed();
		});
	}

	@GameTest(batch = "mimicStaysDormantFarAwayAndRevealsWhenCl", template = EMPTY, timeoutTicks = 160)
	public static void mimicStaysDormantFarAwayAndRevealsWhenClose(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 0.5);
		MimicEntity far = helper.spawn(ModEntities.MIMIC.get(), new Vec3(1.5, 2, 14.5));
		MimicEntity near = helper.spawn(ModEntities.MIMIC.get(), new Vec3(1.5, 2, 6.5));
		helper.assertTrue(far.isNoAi(), "dormant mimic should have NoAI");

		helper.runAfterDelay(20, () -> {
			helper.assertTrue(!far.isRevealed(), "far mimic revealed itself");
			helper.assertTrue(near.isRevealed(), "near mimic did not reveal itself");
			helper.assertTrue(!near.isNoAi(), "revealed mimic should have AI");
			helper.succeed();
		});
	}

	@GameTest(batch = "gauntHuntsPlayerButNotWardHolder", template = EMPTY, timeoutTicks = 200)
	public static void gauntHuntsPlayerButNotWardHolder(GameTestHelper helper) {
		ServerPlayer player = player(helper, 1.5, 1.5);
		GauntEntity hunter = helper.spawn(ModEntities.GAUNT.get(), new Vec3(1.5, 2, 8.5));
		GauntEntity repelled = helper.spawn(ModEntities.GAUNT.get(), new Vec3(1.5, 2, 9.5));

		helper.runAfterDelay(50, () -> {
			helper.assertTrue(hunter.getTarget() == player, "gaunt did not target an unprotected player");
			player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(ModItems.WARDING_CHARM.get()));
			helper.assertTrue(WardingCharmItem.isProtected(player), "charm in hand should protect");
		});

		helper.runAfterDelay(110, () -> {
			helper.assertTrue(hunter.getTarget() == null, "gaunt kept targeting a ward holder");
			helper.assertTrue(repelled.getTarget() == null, "second gaunt targeted a ward holder");
			helper.succeed();
		});
	}

	@GameTest(batch = "gauntBurnsInDaylight", template = EMPTY, timeoutTicks = 120)
	public static void gauntBurnsInDaylight(GameTestHelper helper) {
		helper.getLevel().setDayTime(6000);
		GauntEntity gaunt = helper.spawn(ModEntities.GAUNT.get(), new Vec3(1.5, 2, 1.5));
		gaunt.setNoAi(true);

		helper.succeedWhen(() -> helper.assertTrue(gaunt.isOnFire() || gaunt.isRemoved() || !gaunt.isAlive(),
				"gaunt should catch fire in daylight"));
	}

	@GameTest(batch = "shadeBurnsInLightAndFleesHeldTorch", template = EMPTY, timeoutTicks = 160)
	public static void shadeBurnsInLightAndFleesHeldTorch(GameTestHelper helper) {
		helper.getLevel().setDayTime(6000);
		ServerPlayer player = player(helper, 1.5, 1.5);
		ShadeEntity shade = helper.spawn(ModEntities.SHADE.get(), new Vec3(1.5, 2, 6.5));
		float before = shade.getHealth();
		player.setItemInHand(InteractionHand.MAIN_HAND, new ItemStack(net.minecraft.world.item.Items.TORCH));

		helper.runAfterDelay(60, () -> {
			helper.assertTrue(shade.getHealth() < before || shade.isRemoved(), "shade should burn in daylight");
			helper.assertTrue(shade.getTarget() == null, "shade targeted a player holding a torch");
			helper.succeed();
		});
	}

	@GameTest(batch = "killedHorrorsDropNightmareShards", template = EMPTY, timeoutTicks = 120)
	public static void killedHorrorsDropNightmareShards(GameTestHelper helper) {
		helper.getLevel().setDayTime(18000);

		for (int i = 0; i < 14; i++) {
			GauntEntity gaunt = helper.spawn(ModEntities.GAUNT.get(), new Vec3(1.5, 2, 1.5));
			gaunt.kill();
		}

		helper.runAfterDelay(5, () -> {
			List<ItemEntity> drops = helper.getLevel().getEntitiesOfClass(ItemEntity.class,
					new net.minecraft.world.phys.AABB(helper.absolutePos(new BlockPos(1, 2, 1))).inflate(6.0),
					e -> e.getItem().is(ModItems.NIGHTMARE_SHARD.get()));
			helper.assertTrue(!drops.isEmpty(), "no nightmare shards dropped from 14 kills");
			helper.succeed();
		});
	}

	@GameTest(batch = "recipesAreLoaded", template = EMPTY)
	public static void recipesAreLoaded(GameTestHelper helper) {
		var manager = helper.getLevel().getServer().getRecipeManager();
		helper.assertTrue(manager.byKey(ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, "warding_charm")).isPresent(),
				"warding_charm recipe missing");
		helper.assertTrue(manager.byKey(ResourceLocation.fromNamespaceAndPath(HorrorEntities.MOD_ID, "greater_warding_charm")).isPresent(),
				"greater_warding_charm recipe missing");
		helper.succeed();
	}

	@GameTest(batch = "directorApiSpawnsSnuffsAndClears", template = EMPTY)
	public static void directorApiSpawnsSnuffsAndClears(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		ServerPlayer player = player(helper, 1.5, 1.5);

		DreadDirector.setDread(player, 42.0);
		helper.assertTrue(DreadDirector.getDread(player) == 42.0, "dread not stored");
		DreadDirector.addDread(player, 1000.0);
		helper.assertTrue(DreadDirector.getDread(player) == 100.0, "dread not clamped to 100");

		BlockPos torch = helper.absolutePos(new BlockPos(2, 2, 2));
		level.setBlockAndUpdate(torch, Blocks.TORCH.defaultBlockState());
		helper.assertTrue(DreadDirector.triggerEvent(level, player, "torch"), "torch event refused");
		helper.assertTrue(level.getBlockState(torch).isAir(), "torch was not snuffed");

		helper.assertTrue(DreadDirector.triggerEvent(level, player, "chat"), "chat event refused");
		helper.assertTrue(DreadDirector.triggerEvent(level, player, "ambient"), "ambient event refused");
		helper.assertTrue(!DreadDirector.triggerEvent(level, player, "nonsense"), "unknown event accepted");

		for (String name : DreadDirector.ENTITY_NAMES) {
			helper.assertTrue(DreadDirector.spawnInFront(level, player, name, 6.0), "could not spawn " + name);
		}

		helper.assertTrue(DreadDirector.clearAll(level) >= DreadDirector.ENTITY_NAMES.length, "clearAll removed too few");
		helper.succeed();
	}

	@GameTest(batch = "spawnedFacePlayer", template = EMPTY, timeoutTicks = 60)
	public static void commandSpawnedEntitiesFaceThePlayer(GameTestHelper helper) {
		ServerLevel level = helper.getLevel();
		ServerPlayer player = player(helper, 1.5, 1.5); // facing +Z, so the entity appears south of the player
		helper.assertTrue(DreadDirector.spawnInFront(level, player, "gaunt", 6.0), "could not spawn");

		GauntEntity gaunt = level.getEntitiesOfClass(GauntEntity.class, player.getBoundingBox().inflate(10.0)).get(0);
		float offByFromNorth = Math.abs(net.minecraft.util.Mth.wrapDegrees(gaunt.getYRot() - 180.0F));
		helper.assertTrue(offByFromNorth < 5.0F, "entity should face the player (yaw 180) but has yaw " + gaunt.getYRot());
		helper.succeed();
	}
}
