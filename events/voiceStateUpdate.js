const { Events, ChannelType } = require('discord.js');
const { supabase } = require('../lib/supabase');

module.exports = {
	name: Events.VoiceStateUpdate,

	async execute(oldState, newState) {
		if (!oldState.channelId && newState.channelId) {
            await handleUserJoined(newState);
        }

        if (oldState.channelId && !newState.channelId) {
            await handleUserLeft(oldState);
        }

        if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            await handleUserLeft(oldState);
            await handleUserJoined(newState);
        }
	},
};

async function handleUserJoined(voiceState) {
    const { data: channels, error } = await supabase
            .from('dynamic_vc_rules')
            .select('channel_id, base_label, created_channels')
            .eq('guild_id', voiceState.guild.id);

    if (error || !channels) {
        return;
    }

    for (let i = 0; i < channels.length; i++) {
        if (voiceState.channelId == channels[i].channel_id && channels[i].created_channels.length == 0) {
            const newChannel = await voiceState.guild.channels.create({
                name: `${channels[i].base_label} 2`,
                type: ChannelType.GuildVoice,
            });

            const { err } = await supabase
            .from('dynamic_vc_rules')
            .update({
                created_channels: [newChannel.id],
            })
            .eq('channel_id', channels[i].channel_id);

            if (err || !channels) {
                return;
            }

            return;
        }

        if (channels[i].created_channels.find(c => c == voiceState.channelId)) {
            console.log(channels[i].created_channels);

            const vcNumber = channels[i].created_channels.findIndex(c => c == voiceState.channelId) + 2;
            if (vcNumber == channels[i].created_channels.length + 1) {
                const newChannel = await voiceState.guild.channels.create({
                    name: `${channels[i].base_label} ${vcNumber + 1}`,
                    type: ChannelType.GuildVoice,
                });

                const { err } = await supabase
                .from('dynamic_vc_rules')
                .update({
                    created_channels: [...channels[i].created_channels, newChannel.id],
                })
                .eq('channel_id', channels[i].channel_id);

                if (err || !channels) {
                    return;
                }

                return;
            }

            return;
        }
    }
}

async function handleUserLeft(voiceState) {
    const { data: channels, error } = await supabase
            .from('dynamic_vc_rules')
            .select('channel_id, base_label, created_channels')
            .eq('guild_id', voiceState.guild.id);

    if (error || !channels) {
        return;
    }

    for (let i = 0; i < channels.length; i++) {
        await checkChannels(channels, voiceState);

        // console.log('checking left from base channel', voiceState.channelId, channels[i].channel_id);

        // if (voiceState.channelId == channels[i].channel_id) {
        //     const nextVc = await voiceState.guild.channels.fetch(channels[i].created_channels[0]);
        //     console.log('left from base channel, checking', nextVc.name, nextVc.id);
        //     if (voiceState.channel.members.size == 0 && nextVc.members.size == 0) {
        //         await voiceState.guild.channels.delete(nextVc.id);

        //         const { err } = await supabase
        //         .from('dynamic_vc_rules')
        //         .update({
        //             created_channels: channels[i].created_channels.filter(c => c != nextVc.id),
        //         })
        //         .eq('channel_id', channels[i].channel_id);

        //         if (err || !channels) {
        //             return;
        //         }

        //         return;
        //     }

        //     return;
        // }
    }
}

async function checkChannels(channels, voiceState) {
    for (let i = 0; i < channels.length; i++) {
        let vcList = channels[i].created_channels;
        for (let j = 0; j < channels[i].created_channels.length - 2; j++) {
            console.log('checking pair', j + 2, j + 1);
            currentVc = await voiceState.guild.channels.fetch(channels[i].created_channels[channels[i].created_channels.length - j - 2]);
            nextVc = await voiceState.guild.channels.fetch(channels[i].created_channels[channels[i].created_channels.length - j - 1]);
            console.log('checking', currentVc.name, currentVc.id, nextVc.name, nextVc.id);
            if (currentVc.members.size == 0 && nextVc.members.size == 0) {
                console.log('deleting', nextVc.name, nextVc.id);
                await voiceState.guild.channels.delete(nextVc.id);
                vcList = vcList.filter(c => c != nextVc.id);

                const { err } = await supabase
                .from('dynamic_vc_rules')
                .update({
                    created_channels: vcList,
                })
                .eq('channel_id', channels[i].channel_id);

                if (err || !channels) {
                    return;
                }
            }
        }
    }

}