package com.horrorentities.entity;

import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.ai.goal.FloatGoal;
import net.minecraft.world.entity.ai.goal.LeapAtTargetGoal;
import net.minecraft.world.entity.ai.goal.LookAtPlayerGoal;
import net.minecraft.world.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.ai.goal.target.HurtByTargetGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

/**
 * A starved, long-armed thing that hunts at night. It is faster than you, it leaps, and it hisses
 * from somewhere you cannot see. The sun is the only thing it respects.
 */
public class GauntEntity extends HorrorEntity {
	public GauntEntity(EntityType<? extends GauntEntity> type, Level level) {
		super(type, level);
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Monster.createMonsterAttributes()
				.add(Attributes.MAX_HEALTH, 26.0)
				.add(Attributes.MOVEMENT_SPEED, 0.38)
				.add(Attributes.ATTACK_DAMAGE, 5.0)
				.add(Attributes.FOLLOW_RANGE, 40.0);
	}

	@Override
	protected void registerGoals() {
		this.goalSelector.addGoal(0, new FloatGoal(this));
		this.goalSelector.addGoal(1, new LeapAtTargetGoal(this, 0.45F));
		this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0, true));
		this.goalSelector.addGoal(7, new WaterAvoidingRandomStrollGoal(this, 0.8));
		this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, Player.class, 16.0F));
		this.goalSelector.addGoal(8, new RandomLookAroundGoal(this));
		this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
		this.targetSelector.addGoal(2, new NearestAttackableTargetGoal<>(this, Player.class, 10, true, false, this.targetFilter()));
	}

	@Override
	public void aiStep() {
		if (!this.level().isClientSide && this.isAlive() && this.isSunBurnTick()) {
			this.igniteForSeconds(8.0F);
		}

		super.aiStep();
	}

	@Override
	protected SoundEvent getAmbientSound() {
		return this.random.nextBoolean() ? SoundEvents.CAT_HISS : SoundEvents.SPIDER_AMBIENT;
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return SoundEvents.CAT_HURT;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return SoundEvents.CAT_DEATH;
	}

	@Override
	public float getVoicePitch() {
		return super.getVoicePitch() * 0.5F;
	}

	@Override
	public int getAmbientSoundInterval() {
		return 120;
	}
}
