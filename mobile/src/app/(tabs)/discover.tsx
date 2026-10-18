import { useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  AlertTriangle, BookOpen, Boxes, Briefcase, Calendar, CheckSquare, ChevronRight, Clock, Compass,
  LayoutDashboard, Library, ListChecks, MessageSquare, Newspaper, Plane, Receipt, Search, Ticket,
  type LucideIcon,
} from 'lucide-react-native';

import { Appear, Card, EmptyState, GradientIconBadge, PressableScale, Screen, ScreenHeader, TextField } from '@/components/ui';
import { Domains, Fonts, Radius, Spacing, alpha, type DomainKey } from '@/constants/theme';
import { useEffectiveModules } from '@/context/ModulesContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useTheme } from '@/hooks/use-theme';
import { MODULE_BLURB, MODULE_ROUTE, type EffectiveModule } from '@/lib/modules';
import { isModuleInWorkspace } from '@/lib/workspace';

// Universal-terminology-key matches for module cards — deliberately
// small. Only wrap a label where a real key exists in
// terminologyDefaults.ts; every other module keeps its plain English
// label rather than guessing a mapping (same conservatism as the web
// Layout.jsx's NAV_TERMINOLOGY_KEY).
const MODULE_TERMINOLOGY_KEY: Record<string, string> = {
  tasks: 'task',
};

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  'org-home': Newspaper,
  'knowledge-base': BookOpen,
  tasks: ListChecks,
  expenses: Receipt,
  travel: Plane,
  approvals: CheckSquare,
  'it-helpdesk': Ticket,
  leave: Calendar,
  timesheet: Clock,
  chat: MessageSquare,
  wiki: Library,
  'work-items': Briefcase,
};

const DOMAIN: Record<string, DomainKey> = {
  dashboard: 'dashboard', 'org-home': 'home', 'knowledge-base': 'home',
  tasks: 'tasks', expenses: 'expenses', travel: 'travel', approvals: 'approvals',
  'it-helpdesk': 'helpdesk', leave: 'leave', timesheet: 'timesheet', chat: 'home', wiki: 'dashboard',
  'work-items': 'tasks',
};

export default function DiscoverScreen() {
  const t = useTheme();
  const router = useRouter();
  const { modules, error, loading, refresh } = useEffectiveModules();
  const { workspace } = useWorkspace();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  // Only features this account can actually open — no locked/"ask your
  // admin" placeholders. A module the org hasn't purchased, hasn't turned
  // on, hides from this role, or hasn't allocated a seat for simply isn't
  // part of this list at all.
  //
  // Second, additive gate on top of the existing `m.allowed` check:
  // workspace.enabled_module_keys, from the industry-adaptive Workspace
  // Administration tab (web-only, Settings). `enabled_module_keys` is
  // `null` for every org that hasn't configured a workspace (including
  // every pre-existing org, and while the fetch is still loading) —
  // isModuleInWorkspace() returns true in that case,
  // so this AND never removes anything the first filter already allowed
  // unless an admin has explicitly narrowed the set.
  const { groups, totalCount } = useMemo(() => {
    const allowed = modules
      .filter((m) => m.allowed)
      .filter((m) => isModuleInWorkspace(workspace, m.module_key));
    const filtered = q ? allowed.filter((m) => m.label.toLowerCase().includes(q)) : allowed;
    const g = new Map<string, EffectiveModule[]>();
    for (const m of filtered) {
      const key = m.source || 'Other';
      if (!g.has(key)) g.set(key, []);
      g.get(key)!.push(m);
    }
    const ordered = [...g.entries()].sort(([a], [b]) => {
      if (a === 'Foundational') return -1;
      if (b === 'Foundational') return 1;
      return a.localeCompare(b);
    });
    return { groups: ordered, totalCount: allowed.length };
  }, [modules, q, workspace]);

  function openModule(m: EffectiveModule) {
    const route = MODULE_ROUTE[m.module_key];
    if (route) {
      router.navigate(route as Href);
    } else {
      Alert.alert(m.label, 'This feature is coming to the mobile app soon. For now, use it on the web app.');
    }
  }

  return (
    <Screen onRefresh={refresh} refreshing={loading}>
      <ScreenHeader
        title="Discover"
        subtitle={totalCount > 0
          ? `${totalCount} feature${totalCount === 1 ? '' : 's'} available to you`
          : 'Everything ThingsAlive NeoX offers you'}
        right={<GradientIconBadge icon={<Compass color="#fff" size={20} />} colors={Domains.dashboard.grad} size={40} radius={20} />}
      />

      <TextField
        left={<Search size={16} color={t.textMuted} />}
        placeholder="Search features"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: alpha(t.warning, 0.08), borderColor: alpha(t.warning, 0.25) }}>
          <AlertTriangle size={16} color={t.warning} />
          <Text style={{ flex: 1, color: t.textSoft, fontFamily: Fonts.bodyMedium, fontSize: 12.5 }}>
            Couldn&apos;t verify your plan right now — pull down to retry.
          </Text>
        </Card>
      ) : null}

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search color={t.accent} size={22} />}
            title={q ? 'Nothing matches' : 'No features yet'}
            desc={q
              ? `No feature matches "${query.trim()}".`
              : "Your account isn't set up for any mobile features yet — ask your admin to enable a module or assign you a seat."}
          />
        </Card>
      ) : (
        groups.map(([section, items], gi) => (
          <Appear key={section} index={gi} style={{ gap: Spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginLeft: 2 }}>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' as const }}>
                {section}
              </Text>
              <View style={{ backgroundColor: alpha(t.accent, 0.14), borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: t.accent, fontFamily: Fonts.bodyBold, fontSize: 10 }}>{items.length}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {items.map((m) => (
                <ModuleCard key={m.module_key} m={m} onPress={() => openModule(m)} />
              ))}
            </View>
          </Appear>
        ))
      )}
    </Screen>
  );
}

function ModuleCard({ m, onPress }: { m: EffectiveModule; onPress: () => void }) {
  const t = useTheme();
  const { term } = useWorkspace();
  const Icon = ICONS[m.module_key] ?? Boxes;
  const d = Domains[DOMAIN[m.module_key] ?? 'neutral'];
  const hasRoute = Boolean(MODULE_ROUTE[m.module_key]);
  // Only the small, explicit MODULE_TERMINOLOGY_KEY set gets relabeled;
  // every other module_key has no entry there, so `key` is undefined and
  // this falls straight through to `m.label` unchanged.
  const key = MODULE_TERMINOLOGY_KEY[m.module_key];
  const displayLabel = key ? term(key, m.label) : m.label;

  return (
    <View style={{ width: '48%', marginBottom: Spacing.sm }}>
      <PressableScale onPress={onPress}>
        <Card padded={false} style={{ overflow: 'hidden', backgroundColor: alpha(d.solid, 0.06), borderColor: alpha(d.solid, 0.18) }}>
          <View style={{ padding: 14, gap: 8, minHeight: 134 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <GradientIconBadge icon={<Icon size={20} color="#fff" />} colors={d.grad} size={42} />
              <ChevronRight size={16} color={d.solid} />
            </View>

            <View style={{ gap: 3 }}>
              <Text style={{ color: t.text, fontFamily: Fonts.bodyBold, fontSize: 14 }} numberOfLines={1}>{displayLabel}</Text>
              <Text style={{ color: t.textMuted, fontFamily: Fonts.body, fontSize: 11.5, lineHeight: 15 }} numberOfLines={2}>
                {MODULE_BLURB[m.module_key] ?? 'Manage this from your mobile app'}
              </Text>
              {!hasRoute ? (
                <Text style={{ color: t.textMuted, fontFamily: Fonts.bodySemiBold, fontSize: 9.5, marginTop: 1 }} numberOfLines={1}>
                  Web only for now
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
      </PressableScale>
    </View>
  );
}
