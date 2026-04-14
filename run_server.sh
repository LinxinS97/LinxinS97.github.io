#!/usr/bin/env bash
# Preload pathutil patch to work around Ruby 3.x + pathutil 0.16.2 bug
# (Pathutil#read passes kwargs as positional hash, breaking File.read on Ruby 3+).
export RUBYOPT="-r$(pwd)/_plugins/pathutil_patch.rb"
bundle exec jekyll liveserve
