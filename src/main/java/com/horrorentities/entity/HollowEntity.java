package com.horrorentities.entity;

import com.horrorentities.HorrorConfig;
import com.horrorentities.director.DreadDirector;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.commands.arguments.EntityAnchorArgument;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.DamageTypeTags;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.EntitySelector;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * The White-Eyed One. It never attacks, never speaks, and cannot be hurt: it just stands at the
 * far end of the treeline and watches. Look at it and it is gone; walk toward it and it is gone;
 * hit it and it is gone. Sometimes it leaves something behind.
 */
public class HollowEntity extends PathfinderMob implements HorrorMob {
	private int age;
	private int watchedTicks;

	public HollowEntity(EntityType<? extends HollowEntity> type, Level level) {
		super(type, level);
		this.setPersistenceRequired();
	}

	public static AttributeSupplier.Builder createAttributes() {
		return PathfinderMob.createMobAttributes().add(Attributes.MAX_HEALTH, 20.0);
	}

	@Override
	public void tick() {
		super.tick();

		if (this.level().isClientSide) {
			return;
		}

		this.age++;
		Player player = this.level().getNearestPlayer(this.getX(), this.getY(), this.getZ(), 96.0, EntitySelector.NO_CREATIVE_OR_SPECTATOR);

		if (player == null) {
			if (this.age > 200) {
				this.discard();
			}

			return;
		}

		// Always turn to face the nearest player.
		this.lookAt(EntityAnchorArgument.Anchor.EYES, player.getEyePosition());
		this.setYHeadRot(this.getYRot());
		this.yBodyRot = this.getYRot();

		double dist = Math.sqrt(this.distanceToSqr(player));
		boolean watched = GazeUtil.isLookingAt(player, this);
		this.watchedTicks = watched ? this.watchedTicks + 1 : Math.max(0, this.watchedTicks - 1);

		if (this.watchedTicks >= 50 || dist < 12.0 || this.age > 900) {
			this.leave(player);
		}
	}

	private void leave(Player player) {
		DreadDirector.addDread(player, 4.0);

		if (this.random.nextInt(3) == 0) {
			HorrorFx.soundFor(player, SoundEvents.AMBIENT_CAVE, 0.7F, 0.6F);
		}

		if (HorrorConfig.ENABLE_TRACES.get() && this.random.nextInt(4) == 0) {
			this.leaveTrace();
		}

		HorrorFx.vanish(this);
	}

	/** A netherrack block with a redstone torch on top, where it stood. */
	private void leaveTrace() {
		Level level = this.level();
		BlockPos feet = this.blockPosition();
		int y = SpawnUtil.findStandingY(level, feet.getX(), feet.getY(), feet.getZ(), 2, 2);

		if (y == Integer.MIN_VALUE) {
			return;
		}

		BlockPos base = new BlockPos(feet.getX(), y - 1, feet.getZ());
		BlockState floor = level.getBlockState(base);
		boolean natural = floor.is(BlockTags.DIRT) || floor.is(BlockTags.SAND) || floor.is(Blocks.STONE) || floor.is(Blocks.GRAVEL);

		if (natural && level.getBlockState(base.above()).isAir()) {
			level.setBlockAndUpdate(base, Blocks.NETHERRACK.defaultBlockState());
			level.setBlockAndUpdate(base.above(), Blocks.REDSTONE_TORCH.defaultBlockState());
		}
	}

	@Override
	public boolean hurt(DamageSource source, float amount) {
		if (source.is(DamageTypeTags.BYPASSES_INVULNERABILITY)) {
			return super.hurt(source, amount);
		}

		if (!this.level().isClientSide && source.getEntity() instanceof Player) {
			HorrorFx.vanish(this);
		}

		return false;
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	protected SoundEvent getAmbientSound() {
		return null;
	}

	@Override
	protected SoundEvent getHurtSound(DamageSource source) {
		return null;
	}

	@Override
	protected SoundEvent getDeathSound() {
		return null;
	}

	@Override
	public void addAdditionalSaveData(CompoundTag tag) {
		super.addAdditionalSaveData(tag);
		tag.putInt("HollowAge", this.age);
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		this.age = tag.getInt("HollowAge");
	}
}
