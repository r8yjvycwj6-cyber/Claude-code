package com.horrorentities.entity;

import net.minecraft.block.Blocks;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.ai.goal.FollowTargetGoal;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.PounceAtTargetGoal;
import net.minecraft.entity.ai.goal.RevengeGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.ai.goal.WanderAroundGoal;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.sound.Sound;
import net.minecraft.sound.Sounds;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/**
 * A starved, long-armed thing that hunts at night. It is faster than you, it leaps, and it hisses
 * from somewhere you cannot see. The sun is the only thing it respects.
 */
public class GauntEntity extends HorrorEntity {
	public GauntEntity(World world) {
		super(world);
		this.setBounds(0.6F, 2.0F);
	}

	@Override
	protected void initGoals() {
		this.goals.add(0, new SwimGoal(this));
		this.goals.add(1, new PounceAtTargetGoal(this, 0.45F));
		this.goals.add(2, new MeleeAttackGoal(this, 1.0, true));
		this.goals.add(7, new WanderAroundGoal(this, 0.8));
		this.goals.add(8, new LookAtEntityGoal(this, PlayerEntity.class, 16.0F));
		this.goals.add(8, new LookAroundGoal(this));
		this.attackGoals.add(1, new RevengeGoal(this, true));
		this.attackGoals.add(2, new FollowTargetGoal<PlayerEntity>(this, PlayerEntity.class, 10, true, false, this.targetFilter()));
	}

	@Override
	protected void initializeAttributes() {
		super.initializeAttributes();
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MAX_HEALTH).setBaseValue(26.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MOVEMENT_SPEED).setBaseValue(0.38);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_ATTACK_DAMAGE).setBaseValue(5.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_FOLLOW_RANGE).setBaseValue(40.0);
	}

	@Override
	public void tickMovement() {
		if (!this.world.isClient && this.world.isDay()) {
			float brightness = this.getBrightnessAtEyes();
			BlockPos pos = new BlockPos(this.x, Math.round(this.y), this.z);

			if (brightness > 0.5F && this.random.nextFloat() * 30.0F < (brightness - 0.4F) * 2.0F && this.world.hasDirectSunlight(pos)) {
				this.setOnFireFor(8);
			}
		}

		super.tickMovement();
	}

	@Override
	protected Sound ambientSound() {
		return this.random.nextBoolean() ? Sounds.ENTITY_CAT_HISS : Sounds.ENTITY_SPIDER_AMBIENT;
	}

	@Override
	protected Sound getHurtSound(DamageSource source) {
		return Sounds.ENTITY_CAT_HURT;
	}

	@Override
	protected Sound deathSound() {
		return Sounds.ENTITY_CAT_DEATH;
	}

	@Override
	public float getSoundPitch() {
		return super.getSoundPitch() * 0.5F;
	}

	@Override
	public int getMinAmbientSoundDelay() {
		return 120;
	}
}
