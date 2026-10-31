package com.horrorentities.util;

import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;

public final class SpawnUtil {
	private SpawnUtil() {
	}

	/**
	 * Finds a standing spot (solid floor, {@code headroom} blocks of clear space) in the column x/z,
	 * scanning from {@code startY + range} down to {@code startY - range}. Returns {@link Integer#MIN_VALUE} if none.
	 */
	public static int findStandingY(Level level, int x, int startY, int z, int range, int headroom) {
		BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
		int minY = level.getMinBuildHeight() + 1;
		int maxY = level.getMaxBuildHeight() - headroom - 1;

		for (int y = Math.min(startY + range, maxY); y >= Math.max(startY - range, minY); y--) {
			pos.set(x, y - 1, z);
			BlockState floor = level.getBlockState(pos);

			if (!floor.blocksMotion() || !floor.getFluidState().isEmpty()) {
				continue;
			}

			boolean clear = true;

			for (int h = 0; h < headroom; h++) {
				pos.set(x, y + h, z);
				BlockState state = level.getBlockState(pos);

				if (state.blocksMotion() || !state.getFluidState().isEmpty()) {
					clear = false;
					break;
				}
			}

			if (clear) {
				return y;
			}
		}

		return Integer.MIN_VALUE;
	}

	public static boolean isLoaded(Level level, int x, int z) {
		return level.hasChunkAt(new BlockPos(x, 64, z));
	}
}
