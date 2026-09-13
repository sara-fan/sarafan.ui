# Sarafan UI

[![ci](https://github.com/sara-fan/sarafan.ui/actions/workflows/ci.yml/badge.svg)](https://github.com/sara-fan/sarafan.ui/actions/workflows/ci.yml)
[![publish](https://github.com/sara-fan/sarafan.ui/actions/workflows/publish.yml/badge.svg)](https://github.com/sara-fan/sarafan.ui/actions/workflows/publish.yml)
[![codecov](https://codecov.io/gh/sara-fan/sarafan.ui/graph/badge.svg)](https://codecov.io/gh/sara-fan/sarafan.ui)

Sarafan UI — клиентское веб-приложение «Сарафана», прототипа сервиса помощи в покупке и доставке товаров из зарубежных интернет-магазинов. В текущей версии доступны регистрация и вход по номеру телефона, редактирование профиля и фотографии, просмотр юридических документов и управление согласиями на использование куки и обработку персональных данных.

Приложение построено на Vue 3 и Vuetify и взаимодействует с API Sarafan Core. Vite используется для локальной разработки и сборки, а Nginx обслуживает готовое приложение в Docker-контейнере. Текущая версия использует демонстрационное подтверждение телефона; условия перехода к реальным заказам и платежам описаны в технической документации.

- [Разработка, проверка и эксплуатация](docs/development.md)
