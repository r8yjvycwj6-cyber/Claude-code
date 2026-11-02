package com.horrorentities.entity;

import java.util.EnumSet;

import com.horrorentities.util.SpawnUtil;

import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.player.Player;

/**
 * What the Stalker does while it is not striking: hover at 10-22 blocks from the nearest player,
 * slowly circling and stopping to stare.
 */
public class LurkAroundPlayerGoal extends Goal {
	private static final double MIN_RING = 12.0;
	private static final double MAX_RING = 20.0;

	private final StalkerEntity mob;
	private Player player;
	/** Absolute entity tick at which to pick the next point (keeps counting while it is frozen). */
	private int nextRepathTick;

	public LurkAroundPlayerGoal(StalkerEntity mob) {
		this.mob = mob;
		this.setFlags(EnumSet.of(Flag.MOVE, Flag.LOOK));
	}

	@Override
	public boolean canUse() {
		this.player = this.mob.closestSurvivalPlayer(96.0);
		return this.mob.getTarget() == null && this.player != null;
	}

	@Override
	public boolean canContinueToUse() {
		return this.mob.getTarget() == null && this.player != null && this.player.isAlive();
	}

	@Override
	public void start() {
		this.nextRepathTick = 0;
	}

	@Override
	public void stop() {
		this.mob.getNavigation().stop();
	}

	@Override
	public void tick() {
		this.mob.getLookControl().setLookAt(this.player, 30.0F, 30.0F);

		if (this.mob.tickCount < this.nextRepathTick) {
			return;
		}

		this.nextRepathTick = this.mob.tickCount + 30 + this.mob.getRandom().nextInt(50);
		double dist = Math.sqrt(this.mob.distanceToSqr(this.player));

		// Comfortable distance: now and then it stops to stare, but mostly it keeps moving around you.
		if (dist >= MIN_RING && dist <= MAX_RING + 2.0 && this.mob.getRandom().nextFloat() < 0.15F) {
			this.mob.getNavigation().stop();
			return;
		}

		// Pick the next point on the ring, a bit further round from where it stands now.
		double current = Math.atan2(this.mob.getZ() - this.player.getZ(), this.mob.getX() - this.player.getX());
		double step = (0.6 + this.mob.getRandom().nextDouble() * 0.8) * (this.mob.getRandom().nextBoolean() ? 1 : -1);
		double radius = MIN_RING + this.mob.getRandom().nextDouble() * (MAX_RING - MIN_RING);
		int x = (int) Math.floor(this.player.getX() + Math.cos(current + step) * radius);
		int z = (int) Math.floor(this.player.getZ() + Math.sin(current + step) * radius);

		if (!SpawnUtil.isLoaded(this.mob.level(), x, z)) {
			return;
		}

		int y = SpawnUtil.findStandingY(this.mob.level(), x, (int) this.player.getY(), z, 6, 3);

		if (y != Integer.MIN_VALUE) {
			this.mob.getNavigation().moveTo(x + 0.5, y, z + 0.5, 0.8);
		}
	}
}
