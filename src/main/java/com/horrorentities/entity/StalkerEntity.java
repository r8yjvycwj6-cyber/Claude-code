package com.horrorentities.entity;

import com.horrorentities.HorrorConfig;
import com.horrorentities.item.WardingCharmItem;
import com.horrorentities.registry.ModItems;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntitySelector;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/**
 * The only horror entity of this mod: a tall, silent figure that haunts the player.
 * <ul>
 *   <li>It cannot move or attack while any player is looking at it.</li>
 *   <li>Unobserved, it lurks around you at a distance, circling, and sometimes stutter-steps closer.</li>
 *   <li>Every so often it strikes once (blindness, slowness, a scream) and then slips away again.</li>
 *   <li>While it is near, nobody can sleep.</li>
 *   <li>It can be killed, but it is armoured, capped in how much damage one hit can do, regenerates,
 *       and blinks away from some of the hits it takes.</li>
 * </ul>
 */
public class StalkerEntity extends Monster {
	private static final double WATCH_RANGE = 64.0;
	/** Most damage a single hit can deal (killing blows from /kill and the void ignore this). */
	private static final float MAX_DAMAGE_PER_HIT = 8.0F;
	private static final int GRACE_TICKS = 45 * 20;

	/** Set when the director summoned it: such a Stalker fades away at dawn. */
	private boolean fadesAtDawn;
	private int watchedTicks;
	private int stutterCooldown = 80;
	private int attackCooldown = GRACE_TICKS;
	private int evadeCooldown;
	private int ticksSinceHurt = 1000;

	public StalkerEntity(EntityType<? extends StalkerEntity> type, Level level) {
		super(type, level);
		this.xpReward = 50;
		this.setPersistenceRequired();
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Monster.createMonsterAttributes()
				.add(Attributes.MAX_HEALTH, 160.0)
				.add(Attributes.ARMOR, 12.0)
				.add(Attributes.ARMOR_TOUGHNESS, 8.0)
				.add(Attributes.KNOCKBACK_RESISTANCE, 1.0)
				.add(Attributes.MOVEMENT_SPEED, 0.30)
				.add(Attributes.ATTACK_DAMAGE, 7.0)
				.add(Attributes.FOLLOW_RANGE, 64.0);
	}

	@Override
	protected void registerGoals() {
		this.goalSelector.addGoal(0, new FloatGoal(this));
		this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.1, false));
		this.goalSelector.addGoal(6, new LurkAroundPlayerGoal(this));
		this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, Player.class, 32.0F));
		// It only picks a victim once its strike is ready; the rest of the time it just lurks.
		this.targetSelector.addGoal(1, new NearestAttackableTargetGoal<>(this, Player.class, 10, false, false,
				entity -> this.isAttackReady() && entity instanceof Player player && !WardingCharmItem.isProtected(player)));
	}

	public boolean isAttackReady() {
		return this.attackCooldown <= 0;
	}

	public void setAttackCooldown(int ticks) {
		this.attackCooldown = ticks;
	}

	public void setFadesAtDawn(boolean fades) {
		this.fadesAtDawn = fades;
	}

	public Player closestSurvivalPlayer(double range) {
		return this.level().getNearestPlayer(this.getX(), this.getY(), this.getZ(), range, EntitySelector.NO_CREATIVE_OR_SPECTATOR);
	}

	private boolean isWatched() {
		for (Player player : this.level().players()) {
			if (player.isSpectator() || player.isCreative() || this.distanceToSqr(player) > WATCH_RANGE * WATCH_RANGE) {
				continue;
			}

			if (GazeUtil.isLookingAt(player, this)) {
				return true;
			}
		}

		return false;
	}

	@Override
	public void tick() {
		super.tick();

		if (this.level().isClientSide || this.isRemoved()) {
			return;
		}

		if (this.fadesAtDawn && this.level().isDay()) {
			HorrorFx.vanish(this);
			return;
		}

		if (this.attackCooldown > 0) {
			this.attackCooldown--;
		}

		if (this.evadeCooldown > 0) {
			this.evadeCooldown--;
		}

		// Regenerates once it has been left alone for a few seconds.
		this.ticksSinceHurt++;

		if (this.ticksSinceHurt > 100 && this.tickCount % 20 == 0 && this.getHealth() < this.getMaxHealth()) {
			this.heal(2.0F);
		}

		if (this.tickCount % 20 == 0) {
			this.disturbSleepers();
		}

		if (this.getTarget() instanceof Player target && (WardingCharmItem.isProtected(target) || !this.isAttackReady())) {
			this.setTarget(null);
		}

		boolean watched = this.isWatched();
		Player near = this.closestSurvivalPlayer(WATCH_RANGE * 2);
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
			}

			// Stared at for too long from afar: it is simply somewhere else now.
			if (this.watchedTicks > 160 && dist > 8.0 && near != null) {
				this.watchedTicks = 0;
				this.blinkAround(near.getX(), near.getZ(), 20.0, 28.0);
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

			if (dist > 56.0) {
				// Never loses you: if you outrun it, it is suddenly nearby again.
				this.blinkAround(near.getX(), near.getZ(), 22.0, 30.0);
			} else if (dist > 26.0) {
				this.stutterStepToward(near);
			}
		}
	}

	private void heartbeat(Player player, double dist) {
		int phase = this.tickCount % 24;

		if (dist > 20.0 || (phase != 0 && phase != 5)) {
			return;
		}

		float volume = (float) (1.2 - dist / 20.0);
		HorrorFx.soundFor(player, SoundEvents.NOTE_BLOCK_BASEDRUM, volume, phase == 0 ? 0.55F : 0.5F);
	}

	/** Nobody sleeps with this thing nearby: anyone already in bed is woken (a held Warding Charm protects). */
	private void disturbSleepers() {
		double range = HorrorConfig.SLEEP_BLOCK_RANGE.get();

		for (Player player : this.level().players()) {
			if (player.isSleeping() && !WardingCharmItem.isProtected(player) && this.distanceToSqr(player) <= range * range) {
				player.stopSleeping();
				player.displayClientMessage(Component.translatable("message.horrorentities.woken"), true);
			}
		}
	}

	/** Teleports a few blocks closer along the line to the player, onto safe ground. */
	private void stutterStepToward(Player player) {
		double dx = player.getX() - this.getX();
		double dz = player.getZ() - this.getZ();
		double len = Math.sqrt(dx * dx + dz * dz);

		if (len < 1.0) {
			return;
		}

		double step = 5.0 + this.random.nextDouble() * 4.0;
		this.tryMoveTo((int) Math.floor(this.getX() + dx / len * step), (int) Math.floor(this.getZ() + dz / len * step));
	}

	/** Blinks to a random standing spot on a ring around (cx, cz). Returns whether it found one. */
	public boolean blinkAround(double cx, double cz, double minDist, double maxDist) {
		for (int attempt = 0; attempt < 12; attempt++) {
			double angle = this.random.nextDouble() * Math.PI * 2;
			double dist = minDist + this.random.nextDouble() * (maxDist - minDist);

			if (this.tryMoveTo((int) Math.floor(cx - Math.sin(angle) * dist), (int) Math.floor(cz + Math.cos(angle) * dist))) {
				return true;
			}
		}

		return false;
	}

	private boolean tryMoveTo(int x, int z) {
		if (!SpawnUtil.isLoaded(this.level(), x, z)) {
			return false;
		}

		int y = SpawnUtil.findStandingY(this.level(), x, (int) this.getY(), z, 5, 3);

		if (y == Integer.MIN_VALUE) {
			return false;
		}

		this.moveTo(x + 0.5, y, z + 0.5, this.getYRot(), this.getXRot());
		this.getNavigation().stop();
		return true;
	}

	@Override
	public boolean doHurtTarget(Entity target) {
		boolean hit = super.doHurtTarget(target);

		if (hit && target instanceof Player player) {
			player.addEffect(new MobEffectInstance(MobEffects.BLINDNESS, 80, 0));
			player.addEffect(new MobEffectInstance(MobEffects.MOVEMENT_SLOWDOWN, 80, 1));
			HorrorFx.soundFor(player, SoundEvents.GHAST_SCREAM, 1.6F, 0.5F);
			HorrorFx.soundFor(player, SoundEvents.ELDER_GUARDIAN_CURSE, 1.0F, 0.6F);

			// One strike, then it slips away and goes back to lurking.
			int seconds = HorrorConfig.ATTACK_COOLDOWN_SECONDS.get();
			this.attackCooldown = seconds * 20 + this.random.nextInt(seconds * 10 + 1);
			this.setTarget(null);
			this.blinkAround(player.getX(), player.getZ(), 22.0, 30.0);
		}

		return hit;
	}

	@Override
	public boolean hurt(DamageSource source, float amount) {
		if (!this.level().isClientSide && !source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) {
			amount = Math.min(amount, MAX_DAMAGE_PER_HIT);
		}

		boolean hurt = super.hurt(source, amount);

		if (hurt && !this.level().isClientSide && this.isAlive()) {
			this.ticksSinceHurt = 0;

			// Slippery: some hits make it blink a little way off.
			if (this.evadeCooldown <= 0 && this.random.nextFloat() < 0.35F) {
				this.evadeCooldown = 80;

				if (this.blinkAround(this.getX(), this.getZ(), 8.0, 14.0)) {
					this.level().playSound(null, this.getX(), this.getY(), this.getZ(), SoundEvents.ENDERMAN_TELEPORT,
							net.minecraft.sounds.SoundSource.HOSTILE, 0.6F, 0.5F);
				}
			}
		}

		return hurt;
	}

	@Override
	protected void dropCustomDeathLoot(ServerLevel level, DamageSource source, boolean recentlyHit) {
		super.dropCustomDeathLoot(level, source, recentlyHit);
		this.spawnAtLocation(new ItemStack(ModItems.NIGHTMARE_SHARD.get(), 3 + this.random.nextInt(3)));
	}

	@Override
	public boolean removeWhenFarAway(double distanceToClosestPlayer) {
		return false;
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
		tag.putBoolean("FadesAtDawn", this.fadesAtDawn);
		tag.putInt("AttackCooldown", this.attackCooldown);
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		this.fadesAtDawn = tag.getBoolean("FadesAtDawn");

		if (tag.contains("AttackCooldown")) {
			this.attackCooldown = tag.getInt("AttackCooldown");
		}
	}
}
