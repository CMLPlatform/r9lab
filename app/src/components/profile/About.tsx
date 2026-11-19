import { useCallback } from 'react';
import { View } from 'react-native';
import { DOCS_URL, WEBSITE_URL } from '@/config';
import { openExternalUrl } from '@/services/externalLinks';
import { ProfileAction } from './shared';

const NINE_R_FRAMEWORK_DOCS_PATH = '/project/9r-framework';
const GLOSSARY_DOCS_PATH = '/user-guides/glossary';

// Signed-in people can no longer see the sign-up and sign-in legal links, so they live here too.
const LEGAL_LINKS = [
  { title: 'Terms', path: '/terms' },
  { title: 'Privacy policy', path: '/privacy' },
  { title: 'Accessibility statement', path: '/accessibility' },
] as const;

function WebsiteAction({ title, path }: { title: string; path: string }) {
  const open = useCallback(() => {
    if (WEBSITE_URL) void openExternalUrl(new URL(path, WEBSITE_URL).toString());
  }, [path]);
  return <ProfileAction title={title} onPress={open} />;
}

/** Background/links section: the 9R framework the mark's nine nods to, the glossary and the legal pages. */
export function ProfileAboutSection() {
  const openNineRFramework = useCallback(() => {
    if (DOCS_URL) {
      void openExternalUrl(new URL(NINE_R_FRAMEWORK_DOCS_PATH, DOCS_URL).toString());
    }
  }, []);
  const openGlossary = useCallback(() => {
    if (DOCS_URL) {
      void openExternalUrl(new URL(GLOSSARY_DOCS_PATH, DOCS_URL).toString());
    }
  }, []);

  return (
    <View className="mx-1">
      <ProfileAction
        icon="tag"
        title="Glossary"
        subtitle="What the words in R9lab mean, in plain language"
        onPress={openGlossary}
      />
      <ProfileAction
        icon="info"
        title="The 9R framework"
        subtitle="The nine circular-economy strategies behind R9lab"
        onPress={openNineRFramework}
      />
      {WEBSITE_URL ? LEGAL_LINKS.map((link) => <WebsiteAction key={link.path} {...link} />) : null}
    </View>
  );
}
