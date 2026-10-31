package com.horrorentities.entity;

import com.horrorentities.director.DreadDirector;

import net.minecraft.client.sound.SoundCategory;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.ai.goal.FollowTargetGoal;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.RevengeGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.ai.goal.WanderAroundGoal;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.sound.Sound;
import net.minecraft.sound.Sounds;
import net.minecraft.world.World;

/**
 * The Mimic stands motionless in the dark and imitates the animals and villagers you would expect
 * to hear, always a little too slow and a little too low. Come close enough to believe it and it
 * drops the act and sprints for you.
 */
public class MimicEntity extends HorrorEntity {
	private static final double REVEAL_RANGE = 9.0;

	private boolean revealed;
	private int lureCooldown = 60;

	public MimicEntity(World world) {
		super(world);
		this.setBounds(0.6F, 1.95F);
		this.setAiDisabled(true);
	}

	@Override
	protected void initGoals() {
		this.goals.add(0, new SwimGoal(this));
		this.goals.add(2, new MeleeAttackGoal(this, 1.0, true));
		this.goals.add(7, new WanderAroundGoal(this, 0.8));
		this.goals.add(8, new LookAroundGoal(this));
		this.attackGoals.add(1, new RevengeGoal(this, true));
		this.attackGoals.add(2, new FollowTargetGoal<PlayerEntity>(this, PlayerEntity.class, 10, false, false, this.targetFilter()));
	}

	@Override
	protected void initializeAttributes() {
		super.initializeAttributes();
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MAX_HEALTH).setBaseValue(30.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MOVEMENT_SPEED).setBaseValue(0.3);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_ATTACK_DAMAGE).setBaseValue(6.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_FOLLOW_RANGE).setBaseValue(40.0);
	}

	public boolean isRevealed() {
		return this.revealed;
	}

	@Override
	public void tick() {
		super.tick();

		if (this.world.isClient || this.removed || this.revealed) {
			return;
		}

		PlayerEntity player = this.closestSurvivalPlayer(48.0);

		if (player == null) {
			return;
		}

		this.lookAtEntity(player, 30.0F, 30.0F);
		this.headYaw = this.yaw;

		if (this.squaredDistanceTo(player) < REVEAL_RANGE * REVEAL_RANGE && !this.isRepelledBy(player)) {
			this.reveal(player);
			return;
		}

		if (--this.lureCooldown <= 0) {
			this.lureCooldown = 90 + this.random.nextInt(140);
			this.lure();
		}
	}

	private void lure() {
		Sound[] lures = {
			Sounds.ENTITY_COW_AMBIENT, Sounds.ENTITY_PIG_AMBIENT, Sounds.ENTITY_SHEEP_AMBIENT,
			Sounds.ENTITY_CHICKEN_AMBIENT, Sounds.ENTITY_VILLAGER_AMBIENT, Sounds.ENTITY_VILLAGER_YES
		};
		Sound pick = lures[this.random.nextInt(lures.length)];
		// Slightly detuned: close enough to pass, wrong enough to nag.
		this.world.playSound(null, this.x, this.y, this.z, pick, SoundCategory.NEUTRAL, 1.3F, 0.55F + this.random.nextFloat() * 0.2F);
	}

	private void reveal(PlayerEntity player) {
		this.revealed = true;
		this.setAiDisabled(false);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MOVEMENT_SPEED).setBaseValue(0.42);
		this.setTarget(player);
		this.world.playSound(null, this.x, this.y, this.z, Sounds.ENTITY_GHAST_SCREAM, SoundCategory.HOSTILE, 1.6F, 0.7F);
		DreadDirector.addDread(player, 15.0);
	}

	@Override
	public boolean damage(DamageSource source, float amount) {
		boolean hurt = super.damage(source, amount);

		if (hurt && !this.world.isClient && !this.revealed && source.getAttacker() instanceof PlayerEntity) {
			this.reveal((PlayerEntity) source.getAttacker());
		}

		return hurt;
	}

	@Override
	protected Sound ambientSound() {
		return this.revealed ? Sounds.ENTITY_VILLAGER_NO : null;
	}

	@Override
	protected Sound getHurtSound(DamageSource source) {
		return Sounds.ENTITY_VILLAGER_HURT;
	}

	@Override
	protected Sound deathSound() {
		return Sounds.ENTITY_VILLAGER_DEATH;
	}

	@Override
	public float getSoundPitch() {
		return super.getSoundPitch() * 0.7F;
	}

	@Override
	public void writeCustomDataToNbt(NbtCompound nbt) {
		super.writeCustomDataToNbt(nbt);
		nbt.putBoolean("Revealed", this.revealed);
	}

	@Override
	public void readCustomDataFromNbt(NbtCompound nbt) {
		super.readCustomDataFromNbt(nbt);
		this.revealed = nbt.getBoolean("Revealed");
		this.setAiDisabled(!this.revealed);
	}
}
