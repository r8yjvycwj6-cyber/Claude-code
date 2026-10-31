package com.horrorentities.entity;

import com.google.common.base.Predicate;
import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.registry.ModItems;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;

import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.mob.HostileEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.world.World;

/** Shared behaviour of the aggressive horror entities. */
public abstract class HorrorEntity extends HostileEntity implements HorrorMob {
	/** Ticks the entity has existed; horrors never overstay, they fade away. */
	protected int lifeTicks;
	protected int maxLifeTicks = 6000;

	protected HorrorEntity(World world) {
		super(world);
		this.experiencePoints = 12;
	}

	/** Target filter shared by every follow-target goal: ignore people carrying a ward. */
	protected final Predicate<PlayerEntity> targetFilter() {
		return player -> player != null && !this.isRepelledBy(player);
	}

	protected boolean isRepelledBy(PlayerEntity player) {
		return WardingCharmItem.isProtected(player);
	}

	/** True while any survival player within range is looking straight at this entity. */
	protected boolean isWatched(double range, double cone) {
		for (PlayerEntity player : this.world.playerEntities) {
			if (player.isSpectator() || player.isCreative() || this.squaredDistanceTo(player) > range * range) {
				continue;
			}

			if (GazeUtil.isLookingAt(player, this, cone)) {
				return true;
			}
		}

		return false;
	}

	protected PlayerEntity closestSurvivalPlayer(double range) {
		PlayerEntity best = null;
		double bestDist = range * range;

		for (PlayerEntity player : this.world.playerEntities) {
			if (player.isSpectator() || player.isCreative()) {
				continue;
			}

			double dist = this.squaredDistanceTo(player);

			if (dist < bestDist) {
				bestDist = dist;
				best = player;
			}
		}

		return best;
	}

	@Override
	public void tick() {
		super.tick();

		if (this.world.isClient) {
			return;
		}

		if (++this.lifeTicks > this.maxLifeTicks) {
			HorrorFx.vanish(this);
			return;
		}

		LivingEntity target = this.getTarget();

		if (target instanceof PlayerEntity && this.isRepelledBy((PlayerEntity) target)) {
			this.setTarget(null);
		}
	}

	@Override
	protected boolean canImmediatelyDespawn() {
		return false;
	}

	@Override
	protected void dropLoot(boolean killedByPlayer, int lootingLevel) {
		if (this.random.nextInt(3) != 0) {
			this.dropItem(ModItems.NIGHTMARE_SHARD, 1 + this.random.nextInt(2 + lootingLevel));
		}
	}

	@Override
	public void writeCustomDataToNbt(NbtCompound nbt) {
		super.writeCustomDataToNbt(nbt);
		nbt.putInt("LifeTicks", this.lifeTicks);
	}

	@Override
	public void readCustomDataFromNbt(NbtCompound nbt) {
		super.readCustomDataFromNbt(nbt);
		this.lifeTicks = nbt.getInt("LifeTicks");
	}
}
