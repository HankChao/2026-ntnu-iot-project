if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/app_config.h")
    configure_file("${CMAKE_CURRENT_LIST_DIR}/app_config.example.h" "${CMAKE_CURRENT_LIST_DIR}/app_config.h" COPYONLY)
endif()
idf_component_register(SRCS "raw_main.c" INCLUDE_DIRS "."
    PRIV_REQUIRES esp_driver_gpio esp_driver_i2c esp_driver_touch_sens
                  esp_driver_usb_serial_jtag esp_timer nvs_flash
                  esp_wifi esp_event esp_netif mqtt)
