package com.horrorentities;

import com.horrorentities.client.ClientSetup;
import com.horrorentities.command.HorrorCommand;
import com.horrorentities.director.StalkerDirector;
import com.horrorentities.registry.ModEntities;
import com.horrorentities.registry.ModItems;
import com.mojang.logging.LogUtils;
import org.slf4j.Logger;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.config.ModConfig;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.loading.FMLEnvironment;

@Mod(HorrorEntities.MOD_ID)
public class HorrorEntities {
	public static final String MOD_ID = "horrorentities";
	public static final Logger LOGGER = LogUtils.getLogger();

	public HorrorEntities(FMLJavaModLoadingContext context) {
		IEventBus modBus = context.getModEventBus();

		ModEntities.ENTITIES.register(modBus);
		ModItems.ITEMS.register(modBus);
		ModItems.TABS.register(modBus);
		modBus.addListener(ModEntities::onAttributes);

		context.registerConfig(ModConfig.Type.COMMON, HorrorConfig.SPEC);

		MinecraftForge.EVENT_BUS.addListener(StalkerDirector::onServerTick);
		MinecraftForge.EVENT_BUS.addListener(StalkerDirector::onEntityJoin);
		MinecraftForge.EVENT_BUS.addListener(StalkerDirector::onSleep);
		MinecraftForge.EVENT_BUS.addListener((RegisterCommandsEvent event) -> HorrorCommand.register(event.getDispatcher()));

		if (FMLEnvironment.dist == Dist.CLIENT) {
			ClientSetup.register(modBus);
		}

		LOGGER.info("Horror Entities loaded. Do not look behind you.");
	}
}
