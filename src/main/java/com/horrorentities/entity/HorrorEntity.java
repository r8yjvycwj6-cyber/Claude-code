package com.horrorentities.entity;

import java.util.function.Predicate;

import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.registry.ModItems;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntitySelector;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/** Shared behaviour of the aggressive horror entities. */
public abstract class HorrorEntity extends Monster implements HorrorMob {
	/** Ticks the entity has existed; horrors never overstay, they fade away. */
	protected int lifeTicks;
	protected int maxLifeTicks = 6000;

	protected HorrorEntity(EntityType<? extends HorrorEntity> type, Level level) {
		super(type, level);
		this.xpReward = 12;
	}

	/** Target filter shared by every target goal: ignore people carrying a ward. */
	protected final Predicate<LivingEntity> targetFilter() {
		return entity -> entity instanceof Player player && !this.isRepelledBy(player);
	}

	protected boolean isRepelledBy(Player player) {
		return WardingCharmItem.isProtected(player);
	}

	/** True while any survival player within range is looking straight at this entity. */
	protected boolean isWatched(double range, double cone) {
		for (Player player : this.level().players()) {
			if (player.isSpectator() || player.isCreative() || this.distanceToSqr(player) > range * range) {
				continue;
			}

			if (GazeUtil.isLookingAt(player, this, cone)) {
				return true;
			}
		}

		return false;
	}

	protected Player closestSurvivalPlayer(double range) {
		return this.level().getNearestPlayer(this.getX(), this.getY(), this.getZ(), range, EntitySelector.NO_CREATIVE_OR_SPECTATOR);
	}

	@Override
	public void tick() {
		super.tick();

		if (this.level().isClientSide || this.isRemoved()) {
			return;
		}

		if (++this.lifeTicks > this.maxLifeTicks) {
			HorrorFx.vanish(this);
			return;
		}

		if (this.getTarget() instanceof Player target && this.isRepelledBy(target)) {
			this.setTarget(null);
		}
	}

	@Override
	protected void dropCustomDeathLoot(ServerLevel level, DamageSource source, boolean recentlyHit) {
		super.dropCustomDeathLoot(level, source, recentlyHit);

		if (this.random.nextInt(3) != 0) {
			this.spawnAtLocation(new ItemStack(ModItems.NIGHTMARE_SHARD.get(), 1 + this.random.nextInt(2)));
		}
	}

	@Override
	public void addAdditionalSaveData(CompoundTag tag) {
		super.addAdditionalSaveData(tag);
		tag.putInt("LifeTicks", this.lifeTicks);
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		this.lifeTicks = tag.getInt("LifeTicks");
	}
}
