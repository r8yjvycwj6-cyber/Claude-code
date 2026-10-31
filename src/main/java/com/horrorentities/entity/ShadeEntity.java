package com.horrorentities.entity;

import java.util.List;

import com.horrorentities.HorrorConfig;
import com.horrorentities.util.HorrorFx;

import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.client.particle.ParticleType;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.entity.ai.goal.FollowTargetGoal;
import net.minecraft.entity.ai.goal.LookAroundGoal;
import net.minecraft.entity.ai.goal.LookAtEntityGoal;
import net.minecraft.entity.ai.goal.MeleeAttackGoal;
import net.minecraft.entity.ai.goal.RevengeGoal;
import net.minecraft.entity.ai.goal.SwimGoal;
import net.minecraft.entity.ai.goal.WanderAroundGoal;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.Sound;
import net.minecraft.sound.Sounds;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/**
 * A silhouette that lives where the light does not reach. Light burns it, a held torch keeps it
 * at bay, and it quietly snuffs out any torch it can reach so the dark can come to you.
 */
public class ShadeEntity extends HorrorEntity {
	/** Block light at or above which the shade starts to burn. */
	private static final int BURN_LIGHT = 8;

	public ShadeEntity(World world) {
		super(world);
		this.setBounds(0.6F, 1.95F);
	}

	@Override
	protected void initGoals() {
		this.goals.add(0, new SwimGoal(this));
		this.goals.add(2, new MeleeAttackGoal(this, 1.0, false));
		this.goals.add(7, new WanderAroundGoal(this, 0.7));
		this.goals.add(8, new LookAtEntityGoal(this, PlayerEntity.class, 16.0F));
		this.goals.add(8, new LookAroundGoal(this));
		this.attackGoals.add(1, new RevengeGoal(this, true));
		this.attackGoals.add(2, new FollowTargetGoal<PlayerEntity>(this, PlayerEntity.class, 10, false, false, this.targetFilter()));
	}

	@Override
	protected void initializeAttributes() {
		super.initializeAttributes();
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MAX_HEALTH).setBaseValue(20.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MOVEMENT_SPEED).setBaseValue(0.34);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_ATTACK_DAMAGE).setBaseValue(4.0);
		this.getAttributeContainer().get(EntityAttributes.GENERIC_FOLLOW_RANGE).setBaseValue(32.0);
	}

	/** A shade will not go near anyone holding a light source. */
	@Override
	protected boolean isRepelledBy(PlayerEntity player) {
		return super.isRepelledBy(player) || holdsLight(player);
	}

	private static boolean holdsLight(PlayerEntity player) {
		return isLight(player.getStackInHand(Hand.MAIN_HAND)) || isLight(player.getStackInHand(Hand.OFF_HAND));
	}

	private static boolean isLight(ItemStack stack) {
		Item item = stack.getItem();
		return item == Item.fromBlock(Blocks.TORCH) || item == Item.fromBlock(Blocks.GLOWSTONE)
				|| item == Item.fromBlock(Blocks.SEA_LANTERN) || item == Item.fromBlock(Blocks.JACK_O_LANTERN);
	}

	@Override
	public void tick() {
		super.tick();

		if (this.world.isClient || this.removed) {
			return;
		}

		BlockPos pos = new BlockPos(this.x, this.y + 0.5, this.z);
		int light = this.world.getLightLevel(pos);

		if (light >= BURN_LIGHT) {
			if (this.lifeTicks % 10 == 0) {
				this.damage(DamageSource.GENERIC, 1.0F);

				if (this.world instanceof ServerWorld) {
					((ServerWorld) this.world).addParticle(ParticleType.SMOKE, this.x, this.y + 1.0, this.z, 6, 0.3, 0.6, 0.3, 0.02);
				}
			}
		} else if (this.lifeTicks % 40 == 0 && this.getHealth() < this.getMaxHealth()) {
			this.setHealth(this.getHealth() + 1.0F);
		}

		if (HorrorConfig.enableTorchSnuffing && this.lifeTicks % 60 == 0 && this.random.nextInt(4) == 0) {
			this.snuffNearbyTorch();
		}
	}

	private void snuffNearbyTorch() {
		BlockPos origin = new BlockPos(this.x, this.y, this.z);
		BlockPos.Mutable cursor = new BlockPos.Mutable();

		for (int dx = -3; dx <= 3; dx++) {
			for (int dy = -1; dy <= 3; dy++) {
				for (int dz = -3; dz <= 3; dz++) {
					cursor.setPosition(origin.getX() + dx, origin.getY() + dy, origin.getZ() + dz);
					Block block = this.world.getBlockState(cursor).getBlock();

					if (block == Blocks.TORCH) {
						BlockPos torch = cursor.toImmutable();
						this.world.setBlockState(torch, Blocks.AIR.getDefaultState());
						this.world.spawnEntity(new ItemEntity(this.world, torch.getX() + 0.5, torch.getY() + 0.5, torch.getZ() + 0.5,
								new ItemStack(Blocks.TORCH)));
						this.world.playSound(null, torch.getX() + 0.5, torch.getY() + 0.5, torch.getZ() + 0.5,
								Sounds.BLOCK_FIRE_EXTINGUISH, net.minecraft.client.sound.SoundCategory.BLOCKS, 0.5F, 1.0F);
						return;
					}
				}
			}
		}
	}

	@Override
	public boolean tryAttack(Entity target) {
		boolean hit = super.tryAttack(target);

		if (hit && target instanceof PlayerEntity) {
			PlayerEntity player = (PlayerEntity) target;
			player.addStatusEffect(new StatusEffectInstance(StatusEffects.WEAKNESS, 100, 0));
			player.addStatusEffect(new StatusEffectInstance(StatusEffects.BLINDNESS, 40, 0));
		}

		return hit;
	}

	@Override
	protected Sound ambientSound() {
		return null;
	}

	@Override
	protected Sound getHurtSound(DamageSource source) {
		return Sounds.ENTITY_ENDERMEN_HURT;
	}

	@Override
	protected Sound deathSound() {
		return Sounds.ENTITY_ENDERMEN_DEATH;
	}

	@Override
	public float getSoundPitch() {
		return super.getSoundPitch() * 0.5F;
	}
}
