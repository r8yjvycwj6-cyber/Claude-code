package com.horrorentities.entity;

import com.horrorentities.HorrorConfig;
import com.horrorentities.director.DreadDirector;
import com.horrorentities.util.GazeUtil;
import com.horrorentities.util.HorrorFx;
import com.horrorentities.util.SpawnUtil;

import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.entity.PathAwareEntity;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.damage.DamageSource;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.sound.Sound;
import net.minecraft.sound.Sounds;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/**
 * The White-Eyed One. It never attacks, never speaks, and cannot be hurt: it just stands at the
 * far end of the treeline and watches. Look at it and it is gone; walk toward it and it is gone;
 * hit it and it is gone. Sometimes it leaves something behind.
 */
public class HollowEntity extends PathAwareEntity implements HorrorMob {
	private int age;
	private int watchedTicks;

	public HollowEntity(World world) {
		super(world);
		this.setBounds(0.6F, 1.95F);
		this.setAiDisabled(true);
		this.setPersistent();
	}

	@Override
	protected void initializeAttributes() {
		super.initializeAttributes();
		this.getAttributeContainer().get(EntityAttributes.GENERIC_MAX_HEALTH).setBaseValue(20.0);
	}

	@Override
	public void tick() {
		super.tick();

		if (this.world.isClient) {
			return;
		}

		this.age++;
		PlayerEntity player = this.world.getClosestPlayer(this, 96.0);

		if (player == null || player.isSpectator() || player.isCreative()) {
			if (this.age > 200) {
				this.remove();
			}

			return;
		}

		// Always turn to face the nearest player.
		this.lookAtEntity(player, 360.0F, 360.0F);
		this.headYaw = this.yaw;
		this.bodyYaw = this.yaw;

		double dist = Math.sqrt(this.squaredDistanceTo(player));
		boolean watched = GazeUtil.isLookingAt(player, this);
		this.watchedTicks = watched ? this.watchedTicks + 1 : Math.max(0, this.watchedTicks - 1);

		if (this.watchedTicks >= 50 || dist < 12.0 || this.age > 900) {
			this.leave(player, dist);
		}
	}

	private void leave(PlayerEntity player, double dist) {
		DreadDirector.addDread(player, 4.0);

		if (this.random.nextInt(3) == 0) {
			HorrorFx.soundFor(player, Sounds.AMBIENT_CAVE, 0.7F, 0.6F);
		}

		if (HorrorConfig.enableTraces && this.random.nextInt(4) == 0) {
			this.leaveTrace();
		}

		HorrorFx.vanish(this);
	}

	/** A netherrack block with a redstone torch on top, where it stood. */
	private void leaveTrace() {
		BlockPos feet = new BlockPos(this.x, this.y, this.z);
		int y = SpawnUtil.findStandingY(this.world, feet.getX(), feet.getY(), feet.getZ(), 2, 2);

		if (y < 0) {
			return;
		}

		BlockPos base = new BlockPos(feet.getX(), y - 1, feet.getZ());
		Block floor = this.world.getBlockState(base).getBlock();
		boolean natural = floor == Blocks.GRASS || floor == Blocks.DIRT || floor == Blocks.STONE || floor == Blocks.SAND || floor == Blocks.GRAVEL;

		if (natural && this.world.isAir(base.up())) {
			this.world.setBlockState(base, Blocks.NETHERRACK.getDefaultState());
			this.world.setBlockState(base.up(), Blocks.REDSTONE_TORCH.getDefaultState());
		}
	}

	@Override
	public boolean damage(DamageSource source, float amount) {
		if (source == DamageSource.OUT_OF_WORLD) {
			return super.damage(source, amount);
		}

		if (!this.world.isClient && source.getAttacker() instanceof PlayerEntity) {
			HorrorFx.vanish(this);
		}

		return false;
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	protected Sound ambientSound() {
		return null;
	}

	@Override
	protected Sound getHurtSound(DamageSource source) {
		return null;
	}

	@Override
	protected Sound deathSound() {
		return null;
	}

	@Override
	public void writeCustomDataToNbt(NbtCompound nbt) {
		super.writeCustomDataToNbt(nbt);
		nbt.putInt("HollowAge", this.age);
	}

	@Override
	public void readCustomDataFromNbt(NbtCompound nbt) {
		super.readCustomDataFromNbt(nbt);
		this.age = nbt.getInt("HollowAge");
	}
}
