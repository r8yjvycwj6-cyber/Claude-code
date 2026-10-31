package com.horrorentities.item;

import java.util.List;

import com.horrorentities.entity.HorrorMob;

import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;

/**
 * Hold it in either hand and the things in the dark lose interest in you.
 * Every few seconds spent actually near one of them costs a point of durability.
 */
public class WardingCharmItem extends Item {
	private static final double WARD_RADIUS = 10.0;

	public WardingCharmItem(Properties properties) {
		super(properties.stacksTo(1));
	}

	public static boolean isProtected(Player player) {
		return player.getMainHandItem().getItem() instanceof WardingCharmItem
				|| player.getOffhandItem().getItem() instanceof WardingCharmItem;
	}

	@Override
	public void inventoryTick(ItemStack stack, Level level, Entity holder, int slot, boolean selected) {
		if (level.isClientSide || !(holder instanceof Player player) || holder.tickCount % 40 != 0) {
			return;
		}

		boolean inOffhand = player.getItemInHand(InteractionHand.OFF_HAND) == stack;

		if (!selected && !inOffhand) {
			return;
		}

		List<Entity> nearby = level.getEntitiesOfClass(Entity.class, player.getBoundingBox().inflate(WARD_RADIUS), e -> e instanceof HorrorMob);

		if (!nearby.isEmpty()) {
			stack.hurtAndBreak(1, player, inOffhand ? EquipmentSlot.OFFHAND : EquipmentSlot.MAINHAND);
		}
	}
}
