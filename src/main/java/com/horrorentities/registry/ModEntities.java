package com.horrorentities.registry;

import java.util.function.Supplier;

import com.horrorentities.HorrorEntities;
import com.horrorentities.entity.GauntEntity;
import com.horrorentities.entity.HollowEntity;
import com.horrorentities.entity.MimicEntity;
import com.horrorentities.entity.ShadeEntity;
import com.horrorentities.entity.StalkerEntity;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public final class ModEntities {
	public static final DeferredRegister<EntityType<?>> ENTITIES =
			DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, HorrorEntities.MOD_ID);

	public static final RegistryObject<EntityType<StalkerEntity>> STALKER = register("stalker", StalkerEntity::new, 0.6F, 2.7F);
	public static final RegistryObject<EntityType<HollowEntity>> HOLLOW = register("hollow", HollowEntity::new, 0.6F, 1.95F);
	public static final RegistryObject<EntityType<MimicEntity>> MIMIC = register("mimic", MimicEntity::new, 0.6F, 1.95F);
	public static final RegistryObject<EntityType<GauntEntity>> GAUNT = register("gaunt", GauntEntity::new, 0.6F, 2.0F);
	public static final RegistryObject<EntityType<ShadeEntity>> SHADE = register("shade", ShadeEntity::new, 0.6F, 1.95F);

	private ModEntities() {
	}

	private static <T extends net.minecraft.world.entity.Entity> RegistryObject<EntityType<T>> register(
			String name, EntityType.EntityFactory<T> factory, float width, float height) {
		return ENTITIES.register(name, () -> EntityType.Builder.of(factory, MobCategory.MONSTER)
				.sized(width, height)
				.clientTrackingRange(10)
				.build(HorrorEntities.MOD_ID + ":" + name));
	}

	/** Entity type by the short name used in commands, or null. */
	public static Supplier<? extends EntityType<?>> byName(String name) {
		return switch (name) {
			case "stalker" -> STALKER;
			case "hollow" -> HOLLOW;
			case "mimic" -> MIMIC;
			case "gaunt" -> GAUNT;
			case "shade" -> SHADE;
			default -> null;
		};
	}

	public static void onAttributes(EntityAttributeCreationEvent event) {
		event.put(STALKER.get(), StalkerEntity.createAttributes().build());
		event.put(HOLLOW.get(), HollowEntity.createAttributes().build());
		event.put(MIMIC.get(), MimicEntity.createAttributes().build());
		event.put(GAUNT.get(), GauntEntity.createAttributes().build());
		event.put(SHADE.get(), ShadeEntity.createAttributes().build());
	}
}
