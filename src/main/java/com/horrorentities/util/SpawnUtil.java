package com.horrorentities.util;

import net.minecraft.block.BlockState;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

public final class SpawnUtil {
	private SpawnUtil() {
	}

	/**
	 * Finds a standing spot (solid floor, {@code headroom} blocks of air) in the column x/z,
	 * scanning from {@code startY + range} down to {@code startY - range}. Returns -1 if none.
	 */
	public static int findStandingY(World world, int x, int startY, int z, int range, int headroom) {
		BlockPos.Mutable pos = new BlockPos.Mutable();

		for (int y = startY + range; y >= startY - range; y--) {
			if (y < 2 || y > 250) {
				continue;
			}

			pos.setPosition(x, y - 1, z);
			BlockState floor = world.getBlockState(pos);

			if (!floor.getMaterial().blocksMovement() || floor.getMaterial().isFluid()) {
				continue;
			}

			boolean clear = true;

			for (int h = 0; h < headroom; h++) {
				pos.setPosition(x, y + h, z);

				if (world.getBlockState(pos).getMaterial().blocksMovement() || world.getBlockState(pos).getMaterial().isFluid()) {
					clear = false;
					break;
				}
			}

			if (clear) {
				return y;
			}
		}

		return -1;
	}

	public static boolean isLoaded(World world, int x, int z) {
		return world.isLoaded(new BlockPos(x, 64, z), false);
	}
}
