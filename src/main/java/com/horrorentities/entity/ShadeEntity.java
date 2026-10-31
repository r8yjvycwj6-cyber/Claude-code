package com.horrorentities.entity;

import com.horrorentities.HorrorConfig;

import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.InteractionHand;
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
import net.minecraft.world.entity.ai.goal.RandomLookAroundGoal;
import net.minecraft.world.entity.ai.goal.WaterAvoidingRandomStrollGoal;
import net.minecraft.world.entity.ai.goal.target.HurtByTargetGoal;
import net.minecraft.world.entity.ai.goal.target.NearestAttackableTargetGoal;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * A silhouette that lives where the light does not reach. Light burns it, a held torch keeps it
 * at bay, and it quietly snuffs out any torch it can reach so the dark can come to you.
 */
public class ShadeEntity extends HorrorEntity {
	/** Light level at or above which the shade starts to burn. */
	private static final int BURN_LIGHT = 8;

	public ShadeEntity(EntityType<? extends ShadeEntity> type, Level level) {
		super(type, level);
	}

	public static AttributeSupplier.Builder createAttributes() {
		return Monster.createMonsterAttributes()
				.add(Attributes.MAX_HEALTH, 20.0)
				.add(Attributes.MOVEMENT_SPEED, 0.34)
				.add(Attributes.ATTACK_DAMAGE, 4.0)
				.add(Attributes.FOLLOW_RANGE, 32.0);
	}

	@Override
	protected void registerGoals() {
		this.goalSelector.addGoal(0, new FloatGoal(this));
		this.goalSelector.addGoal(2, new MeleeAttackGoal(this, 1.0, false));
		this.goalSelector.addGoal(7, new WaterAvoidingRandomStrollGoal(this, 0.7));
		this.goalSelector.addGoal(8, new LookAtPlayerGoal(this, Player.class, 16.0F));
		this.goalSelector.addGoal(8, new RandomLookAroundGoal(this));
		this.targetSelector.addGoal(1, new HurtByTargetGoal(this));
		this.targetSelector.addGoal(2, new NearestAttackableTargetGoal<>(this, Player.class, 10, false, false, this.targetFilter()));
	}

	/** A shade will not go near anyone holding a light source. */
	@Override
	protected boolean isRepelledBy(Player player) {
		return super.isRepelledBy(player) || holdsLight(player);
	}

	private static boolean holdsLight(Player player) {
		return isLight(player.getItemInHand(InteractionHand.MAIN_HAND)) || isLight(player.getItemInHand(InteractionHand.OFF_HAND));
	}

	private static boolean isLight(ItemStack stack) {
		Item item = stack.getItem();
		return item == Items.TORCH || item == Items.SOUL_TORCH || item == Items.LANTERN || item == Items.SOUL_LANTERN
				|| item == Items.GLOWSTONE || item == Items.SEA_LANTERN || item == Items.JACK_O_LANTERN || item == Items.SHROOMLIGHT;
	}

	@Override
	public void tick() {
		super.tick();

		if (this.level().isClientSide || this.isRemoved()) {
			return;
		}

		int light = this.level().getMaxLocalRawBrightness(BlockPos.containing(this.getX(), this.getY() + 0.5, this.getZ()));

		if (light >= BURN_LIGHT) {
			if (this.lifeTicks % 10 == 0) {
				this.hurt(this.damageSources().generic(), 1.0F);

				if (this.level() instanceof ServerLevel serverLevel) {
					serverLevel.sendParticles(ParticleTypes.SMOKE, this.getX(), this.getY() + 1.0, this.getZ(), 6, 0.3, 0.6, 0.3, 0.02);
				}
			}
		} else if (this.lifeTicks % 40 == 0 && this.getHealth() < this.getMaxHealth()) {
			this.heal(1.0F);
		}

		if (HorrorConfig.ENABLE_TORCH_SNUFFING.get() && this.lifeTicks % 60 == 0 && this.random.nextInt(4) == 0) {
			this.snuffNearbyTorch();
		}
	}

	private void snuffNearbyTorch() {
		BlockPos origin = this.blockPosition();
		BlockPos.MutableBlockPos cursor = new BlockPos.MutableBlockPos();

		for (int dx = -3; dx <= 3; dx++) {
			for (int dy = -1; dy <= 3; dy++) {
				for (int dz = -3; dz <= 3; dz++) {
					cursor.set(origin.getX() + dx, origin.getY() + dy, origin.getZ() + dz);
					BlockState state = this.level().getBlockState(cursor);

					if (state.is(Blocks.TORCH) || state.is(Blocks.WALL_TORCH)) {
						this.level().destroyBlock(cursor.immutable(), true, this);
						return;
					}
				}
			}
		}
	}

	@Override
	public boolean doHurtTarget(Entity target) {
		boolean hit = super.doHurtTarget(target);

		if (hit && target instanceof Player player) {
			player.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 100, 0));
			player.addEffect(new MobEffectInstance(MobEffects.BLINDNESS, 40, 0));
		}

		return hit;
	}

	@Override
	protected SoundEvent getAmbientSound() {
		return null;
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return SoundEvents.ENDERMAN_HURT;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return SoundEvents.ENDERMAN_DEATH;
	}

	@Override
	public float getVoicePitch() {
		return super.getVoicePitch() * 0.5F;
	}
}
