package com.horrorentities.item;

import java.util.List;

import com.horrorentities.entity.HorrorMob;

import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.Hand;
import net.minecraft.util.math.Box;
import net.minecraft.world.World;

/**
 * Hold it in either hand and the things in the dark lose interest in you.
 * Every few seconds spent actually near one of them costs a point of durability.
 */
public class WardingCharmItem extends Item {
	private static final double WARD_RADIUS = 10.0;

	public WardingCharmItem(int durability) {
		this.setMaxCount(1);
		this.setMaxDamage(durability);
	}

	public static boolean isProtected(PlayerEntity player) {
		return player.getStackInHand(Hand.MAIN_HAND).getItem() instanceof WardingCharmItem
				|| player.getStackInHand(Hand.OFF_HAND).getItem() instanceof WardingCharmItem;
	}

	@Override
	public void inventoryTick(ItemStack stack, World world, Entity holder, int slot, boolean selected) {
		if (world.isClient || !(holder instanceof PlayerEntity) || holder.ticksAlive % 40 != 0) {
			return;
		}

		PlayerEntity player = (PlayerEntity) holder;

		if (!isProtected(player) || (!selected && player.getStackInHand(Hand.OFF_HAND) != stack)) {
			return;
		}

		Box area = player.getBoundingBox().expand(WARD_RADIUS);
		List<Entity> nearby = world.getEntitiesInBox(Entity.class, area, e -> e instanceof HorrorMob);

		if (!nearby.isEmpty()) {
			stack.damage(1, (LivingEntity) player);
		}
	}

	@Override
	public boolean isEnchantable(ItemStack stack) {
		return false;
	}
}
