package com.horrorentities.entity;

import com.horrorentities.director.DreadDirector;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.ai.goal.target.HurtByTargetGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

/**
 * The Mimic stands motionless in the dark and imitates the animals and villagers you would expect
 * to hear, always a little too slow and a little too low. Come close enough to believe it and it
 * drops the act and sprints for you.
 */
public class MimicEntity extends HorrorEntity {
	private static final double REVEAL_RANGE = 9.0;

	private boolean revealed;
	private int lureCooldown = 60;

	public MimicEntity(EntityType<? extends MimicEntity> type, Level level) {
		super(type, level);
		this.setNoAi(true);
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Monster.createMonsterAttributes()
				.add(Attributes.MAX_HEALTH, 30.0)
				.add(Attributes.MOVEMENT_SPEED, 0.3)
				.add(Attributes.ATTACK_DAMAGE, 6.0)
				.add(Attributes.FOLLOW_RANGE, 40.0);
	}

	@Override
	protected void registerGoals() {
		this.goalSelector.addGoal(0, new FloatGoal(this));
		this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0, true));
		this.goalSelector.addGoal(7, new WaterAvoidingRandomStrollGoal(this, 0.8));
		this.goalSelector.addGoal(8, new RandomLookAroundGoal(this));
		this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
		this.targetSelector.addGoal(2, new NearestAttackableTargetGoal<>(this, Player.class, 10, false, false, this.targetFilter()));
	}

	public boolean isRevealed() {
		return this.revealed;
	}

	@Override
	public void tick() {
		super.tick();

		if (this.level().isClientSide || this.isRemoved() || this.revealed) {
			return;
		}

		Player player = this.closestSurvivalPlayer(48.0);

		if (player == null) {
			return;
		}

		this.getLookControl().setLookAt(player, 30.0F, 30.0F);
		this.getLookControl().tick();

		if (this.distanceToSqr(player) < REVEAL_RANGE * REVEAL_RANGE && !this.isRepelledBy(player)) {
			this.reveal(player);
			return;
		}

		if (--this.lureCooldown <= 0) {
			this.lureCooldown = 90 + this.random.nextInt(140);
			this.lure();
		}
	}

	private void lure() {
		SoundEvent[] lures = {
			SoundEvents.COW_AMBIENT, SoundEvents.PIG_AMBIENT, SoundEvents.SHEEP_AMBIENT,
			SoundEvents.CHICKEN_AMBIENT, SoundEvents.VILLAGER_AMBIENT, SoundEvents.VILLAGER_YES
		};
		SoundEvent pick = lures[this.random.nextInt(lures.length)];
		// Slightly detuned: close enough to pass, wrong enough to nag.
		this.level().playSound(null, this.getX(), this.getY(), this.getZ(), pick, SoundSource.NEUTRAL, 1.3F,
				0.55F + this.random.nextFloat() * 0.2F);
	}

	private void reveal(Player player) {
		this.revealed = true;
		this.setNoAi(false);
		this.getAttribute(Attributes.MOVEMENT_SPEED).setBaseValue(0.42);
		this.setTarget(player);
		this.level().playSound(null, this.getX(), this.getY(), this.getZ(), SoundEvents.GHAST_SCREAM, SoundSource.HOSTILE, 1.6F, 0.7F);
		DreadDirector.addDread(player, 15.0);
	}

	@Override
	public boolean hurt(DamageSource source, float amount) {
		boolean hurt = super.hurt(source, amount);

		if (hurt && !this.level().isClientSide && !this.revealed && source.getEntity() instanceof Player player) {
			this.reveal(player);
		}

		return hurt;
	}

	@Override
	protected SoundEvent getAmbientSound() {
		return this.revealed ? SoundEvents.VILLAGER_NO : null;
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return SoundEvents.VILLAGER_HURT;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return SoundEvents.VILLAGER_DEATH;
	}

	@Override
	public float getVoicePitch() {
		return super.getVoicePitch() * 0.7F;
	}

	@Override
	public void addAdditionalSaveData(CompoundTag tag) {
		super.addAdditionalSaveData(tag);
		tag.putBoolean("Revealed", this.revealed);
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		this.revealed = tag.getBoolean("Revealed");
		this.setNoAi(!this.revealed);
	}
}
