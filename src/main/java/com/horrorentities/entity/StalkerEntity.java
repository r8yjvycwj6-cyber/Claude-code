package com.horrorentities.entity;

import com.horrorentities.director.DreadDirector;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.entity.Entity;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.ai.goal.FollowTargetGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.ai.goal.WanderAroundGoal;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.sound.Sound;
import net.minecraft.sound.Sounds;
import net.minecraft.world.World;

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

	public StalkerEntity(World world) {
		super(world);
		this.setBounds(0.6F, 2.7F);
		this.maxLifeTicks = 7200;
	}

	@Override
	protected void initGoals() {
		this.goals.add(0, new SwimGoal(this));
		this.goals.add(2, new MeleeAttackGoal(this, 1.0, false));
		this.goals.add(7, new WanderAroundGoal(this, 0.6));
		this.goals.add(8, new LookAtEntityGoal(this, PlayerEntity.class, 32.0F));
		this.attackGoals.add(1, new FollowTargetGoal<PlayerEntity>(this, PlayerEntity.class, 10, false, false, this.targetFilter()));
	}

	@Override
	protected void initializeAttributes() {
		super.initializeAttributes();
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MAX_HEALTH).setBaseValue(40.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MOVEMENT_SPEED).setBaseValue(0.33);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_ATTACK_DAMAGE).setBaseValue(7.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_FOLLOW_RANGE).setBaseValue(64.0);
	}

	@Override
	public float getEyeHeight() {
		return 2.45F;
	}

	@Override
	public void tick() {
		super.tick();

		if (this.world.isClient || this.removed) {
			return;
		}

		boolean watched = this.isWatched(WATCH_RANGE, GazeUtil.DEFAULT_CONE);
		PlayerEntity near = this.closestSurvivalPlayer(WATCH_RANGE);
		double dist = near == null ? Double.MAX_VALUE : Math.sqrt(this.squaredDistanceTo(near));

		// Frozen solid while observed (NoAI also stops it attacking).
		this.setAiDisabled(watched);

		if (watched) {
			this.watchedTicks++;
			this.velocityX = 0;
			this.velocityZ = 0;

			if (near != null && dist < 12.0 && this.watchedTicks > 60 && this.watchedTicks % 50 == 0) {
				near.addStatusEffect(new StatusEffectInstance(StatusEffects.BLINDNESS, 40, 0));
				near.addStatusEffect(new StatusEffectInstance(StatusEffects.SLOWNESS, 60, 1));
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

	private void heartbeat(PlayerEntity player, double dist) {
		if (dist > 20.0 || this.lifeTicks % 24 != 0 && this.lifeTicks % 24 != 5) {
			return;
		}

		float volume = (float) (1.2 - dist / 20.0);
		HorrorFx.soundFor(player, Sounds.BLOCK_NOTE_BASEDRUM, volume, this.lifeTicks % 24 == 0 ? 0.55F : 0.5F);
	}

	/** Teleports a few blocks closer along the line to the player, onto safe ground. */
	private void stutterStepToward(PlayerEntity player) {
		double dx = player.x - this.x;
		double dz = player.z - this.z;
		double len = Math.sqrt(dx * dx + dz * dz);

		if (len < 1.0) {
			return;
		}

		double step = 4.0 + this.random.nextDouble() * 3.0;
		int tx = (int) Math.floor(this.x + dx / len * step);
		int tz = (int) Math.floor(this.z + dz / len * step);

		if (!SpawnUtil.isLoaded(this.world, tx, tz)) {
			return;
		}

		int ty = SpawnUtil.findStandingY(this.world, tx, (int) this.y, tz, 4, 3);

		if (ty >= 0) {
			this.refreshPositionAndAngles(tx + 0.5, ty, tz + 0.5, this.yaw, this.pitch);
			this.getNavigation().stop();
		}
	}

	@Override
	public boolean tryAttack(Entity target) {
		boolean hit = super.tryAttack(target);

		if (hit && target instanceof PlayerEntity) {
			PlayerEntity player = (PlayerEntity) target;
			player.addStatusEffect(new StatusEffectInstance(StatusEffects.BLINDNESS, 80, 0));
			player.addStatusEffect(new StatusEffectInstance(StatusEffects.SLOWNESS, 80, 1));
			HorrorFx.soundFor(player, Sounds.ENTITY_GHAST_SCREAM, 1.6F, 0.5F);
			HorrorFx.soundFor(player, Sounds.ENTITY_ELDER_GUARDIAN_CURSE, 1.0F, 0.6F);
			DreadDirector.addDread(player, 25.0);
			HorrorFx.vanish(this);
		}

		return hit;
	}

	@Override
	protected Sound ambientSound() {
		return null; // silence is the point
	}

	@Override
	protected Sound getHurtSound(DamageSource source) {
		return Sounds.ENTITY_ENDERMEN_HURT;
	}

	@Override
	protected Sound deathSound() {
		return null;
	}

	@Override
	public void writeCustomDataToNbt(NbtCompound nbt) {
		super.writeCustomDataToNbt(nbt);
		nbt.putInt("WatchedTicks", this.watchedTicks);
	}

	@Override
	public void readCustomDataFromNbt(NbtCompound nbt) {
		super.readCustomDataFromNbt(nbt);
		this.watchedTicks = nbt.getInt("WatchedTicks");
	}
}
