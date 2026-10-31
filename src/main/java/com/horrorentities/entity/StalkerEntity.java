package com.horrorentities.entity;

import com.horrorentities.director.DreadDirector;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

/**
 * A tall, silent figure that is only ever seen at the edge of the dark.
 * <ul>
 *   <li>It cannot move or attack while any player is looking at it.</li>
 *   <li>Look away and it closes the distance, sometimes in sudden stutter-steps.</li>
 *   <li>Stare at it for too long and it simply isn't there any more.</li>
 *   <li>If it reaches you it gets exactly one strike, then vanishes.</li>
 * </ul>
 */
public class StalkerEntity extends HorrorEntity {
	private static final double WATCH_RANGE = 64.0;

	private int watchedTicks;
	private int stutterCooldown = 80;

	public StalkerEntity(EntityType<? extends StalkerEntity> type, Level level) {
		super(type, level);
		this.maxLifeTicks = 7200;
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Monster.createMonsterAttributes()
				.add(Attributes.MAX_HEALTH, 40.0)
				.add(Attributes.MOVEMENT_SPEED, 0.33)
				.add(Attributes.ATTACK_DAMAGE, 7.0)
				.add(Attributes.FOLLOW_RANGE, 64.0);
	}

	@Override
	protected void registerGoals() {
		this.goalSelector.addGoal(0, new FloatGoal(this));
		this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0, false));
		this.goalSelector.addGoal(7, new WaterAvoidingRandomStrollGoal(this, 0.6));
		this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, Player.class, 32.0F));
		this.targetSelector.addGoal(1, new NearestAttackableTargetGoal<>(this, Player.class, 10, false, false, this.targetFilter()));
	}

	@Override
	public void tick() {
		super.tick();

		if (this.level().isClientSide || this.isRemoved()) {
			return;
		}

		boolean watched = this.isWatched(WATCH_RANGE, GazeUtil.DEFAULT_CONE);
		Player near = this.closestSurvivalPlayer(WATCH_RANGE);
		double dist = near == null ? Double.MAX_VALUE : Math.sqrt(this.distanceToSqr(near));

		// Frozen solid while observed (NoAI also stops it attacking).
		this.setNoAi(watched);

		if (watched) {
			this.watchedTicks++;
			this.setDeltaMovement(0.0, this.getDeltaMovement().y, 0.0);
			this.getNavigation().stop();

			if (near != null && dist < 12.0 && this.watchedTicks > 60 && this.watchedTicks % 50 == 0) {
				near.addEffect(new MobEffectInstance(MobEffects.BLINDNESS, 40, 0));
				near.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 60, 1));
				DreadDirector.addDread(near, 6.0);
			}

			// Seen for too long from far away: it was never really there.
			if (this.watchedTicks > 160 && dist > 8.0) {
				HorrorFx.vanish(this);
			}

			return;
		}

		this.watchedTicks = Math.max(0, this.watchedTicks - 2);

		if (near == null) {
			return;
		}

		this.heartbeat(near, dist);

		if (--this.stutterCooldown <= 0) {
			this.stutterCooldown = 50 + this.random.nextInt(70);

			if (dist > 9.0) {
				this.stutterStepToward(near);
			}
		}
	}

	private void heartbeat(Player player, double dist) {
		int phase = this.lifeTicks % 24;

		if (dist > 20.0 || (phase != 0 && phase != 5)) {
			return;
		}

		float volume = (float) (1.2 - dist / 20.0);
		HorrorFx.soundFor(player, SoundEvents.NOTE_BLOCK_BASEDRUM, volume, phase == 0 ? 0.55F : 0.5F);
	}

	/** Teleports a few blocks closer along the line to the player, onto safe ground. */
	private void stutterStepToward(Player player) {
		double dx = player.getX() - this.getX();
		double dz = player.getZ() - this.getZ();
		double len = Math.sqrt(dx * dx + dz * dz);

		if (len < 1.0) {
			return;
		}

		double step = 4.0 + this.random.nextDouble() * 3.0;
		int tx = (int) Math.floor(this.getX() + dx / len * step);
		int tz = (int) Math.floor(this.getZ() + dz / len * step);

		if (!SpawnUtil.isLoaded(this.level(), tx, tz)) {
			return;
		}

		int ty = SpawnUtil.findStandingY(this.level(), tx, (int) this.getY(), tz, 4, 3);

		if (ty != Integer.MIN_VALUE) {
			this.moveTo(tx + 0.5, ty, tz + 0.5, this.getYRot(), this.getXRot());
			this.getNavigation().stop();
		}
	}

	@Override
	public boolean doHurtTarget(Entity target) {
		boolean hit = super.doHurtTarget(target);

		if (hit && target instanceof Player player) {
			player.addEffect(new MobEffectInstance(MobEffects.BLINDNESS, 80, 0));
			player.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 80, 1));
			HorrorFx.soundFor(player, SoundEvents.GHAST_SCREAM, 1.6F, 0.5F);
			HorrorFx.soundFor(player, SoundEvents.ELDER_GUARDIAN_CURSE, 1.0F, 0.6F);
			DreadDirector.addDread(player, 25.0);
			HorrorFx.vanish(this);
		}

		return hit;
	}

	@Override
	protected SoundEvent getAmbientSound() {
		return null; // silence is the point
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return SoundEvents.ENDERMAN_HURT;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return null;
	}

	@Override
	public void addAdditionalSaveData(CompoundTag tag) {
		super.addAdditionalSaveData(tag);
		tag.putInt("WatchedTicks", this.watchedTicks);
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		this.watchedTicks = tag.getInt("WatchedTicks");
	}
}
