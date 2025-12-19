/**
 * Icon categorization system
 * Groups icons by prefix/pattern for better browsing experience
 */

export interface IconCategory {
  id: string
  name: string
  icon: string // codicon name for the category icon
  /** Patterns to match icon names (case-insensitive) */
  patterns: string[]
}

// =============================================================================
// Codicons Categories
// =============================================================================

export const CODICON_CATEGORIES: IconCategory[] = [
  { id: 'files', name: 'Files', icon: 'file', patterns: ['file-', 'gist-', 'folder', 'directory', 'new-file', 'new-folder'] },
  { id: 'git', name: 'Git', icon: 'git-branch', patterns: ['git-', 'repo-', 'source-control', 'diff', 'merge', 'clone'] },
  { id: 'debug', name: 'Debug', icon: 'debug', patterns: ['debug-', 'breakpoint', 'callstack', 'watch', 'variable'] },
  { id: 'symbols', name: 'Symbols', icon: 'symbol-class', patterns: ['symbol-'] },
  { id: 'arrows', name: 'Arrows', icon: 'arrow-right', patterns: ['arrow-', 'chevron-', 'triangle-'] },
  { id: 'ui', name: 'UI', icon: 'window', patterns: ['chrome-', 'layout-', 'split-', 'panel-', 'sidebar-', 'editor-', 'window', 'menu'] },
  { id: 'media', name: 'Media', icon: 'play', patterns: ['play', 'pause', 'stop', 'record', 'mute', 'unmute', 'volume'] },
  { id: 'editing', name: 'Editing', icon: 'edit', patterns: ['edit', 'pencil', 'copy', 'paste', 'cut', 'undo', 'redo', 'find', 'replace', 'selection'] },
  { id: 'terminal', name: 'Terminal', icon: 'terminal', patterns: ['terminal-', 'console', 'repl'] },
  { id: 'people', name: 'People', icon: 'person', patterns: ['person', 'account', 'organization', 'team'] },
  { id: 'notifications', name: 'Notifications', icon: 'bell', patterns: ['bell', 'alert', 'warning', 'error', 'info', 'question'] },
]

// =============================================================================
// Font Awesome Categories
// =============================================================================

export const FONTAWESOME_CATEGORIES: IconCategory[] = [
  { id: 'brands', name: 'Brands', icon: 'github', patterns: [
    'Github', 'Google', 'Facebook', 'Twitter', 'Instagram', 'Youtube', 'Linkedin', 'Discord', 'Slack', 'Spotify',
    'Amazon', 'Apple', 'Microsoft', 'Adobe', 'Figma', 'Dribbble', 'Behance', 'Pinterest', 'Reddit', 'Twitch',
    'Paypal', 'Stripe', 'Shopify', 'Wordpress', 'Docker', 'Linux', 'Windows', 'Android', 'Swift', 'React',
    'Angular', 'Vue', 'Node', 'Python', 'Java', 'Php', 'Rust', 'Npm', 'Yarn', 'Git', 'Bitbucket', 'Gitlab',
    'Jira', 'Confluence', 'Trello', 'Asana', 'Notion', 'Airtable', 'Dropbox', 'Aws', 'Azure', 'Cloudflare',
    'Heroku', 'Netlify', 'Vercel', 'Firebase', 'Supabase', 'Mongodb', 'Mysql', 'Postgresql', 'Redis', 'Elasticsearch',
    'Whatsapp', 'Telegram', 'Signal', 'Skype', 'Zoom', 'Teams', 'Uber', 'Airbnb', 'Netflix', 'Hulu',
    'Tiktok', 'Snapchat', 'Tumblr', 'Vimeo', 'Soundcloud', 'Bandcamp', 'Patreon', 'Kickstarter', 'Producthunt', 'Medium'
  ] },
  { id: 'arrows', name: 'Arrows', icon: 'arrow-right', patterns: ['Arrow', 'Chevron', 'Angle', 'Caret', 'Circle-Arrow', 'Square-Arrow'] },
  { id: 'files', name: 'Files', icon: 'file', patterns: ['File', 'Folder', 'Clipboard', 'Copy', 'Paste'] },
  { id: 'media', name: 'Media', icon: 'play', patterns: ['Play', 'Pause', 'Stop', 'Volume', 'Music', 'Video', 'Film', 'Camera', 'Microphone', 'Headphones'] },
  { id: 'communication', name: 'Communication', icon: 'comment', patterns: ['Comment', 'Message', 'Envelope', 'Mail', 'Phone', 'Fax', 'At'] },
  { id: 'users', name: 'Users', icon: 'person', patterns: ['User', 'Person', 'People', 'Users', 'Group'] },
  { id: 'business', name: 'Business', icon: 'briefcase', patterns: ['Building', 'Business', 'Briefcase', 'Industry', 'Store', 'Shop', 'Cart', 'Bag'] },
  { id: 'medical', name: 'Medical', icon: 'heart', patterns: ['Heart', 'Hospital', 'Ambulance', 'Pills', 'Syringe', 'Stethoscope', 'Thermometer', 'Virus', 'Bacteria'] },
  { id: 'transport', name: 'Transport', icon: 'rocket', patterns: ['Car', 'Truck', 'Bus', 'Train', 'Plane', 'Ship', 'Bicycle', 'Motorcycle', 'Helicopter', 'Rocket'] },
  { id: 'weather', name: 'Weather', icon: 'cloud', patterns: ['Sun', 'Moon', 'Cloud', 'Rain', 'Snow', 'Wind', 'Bolt', 'Temperature'] },
  { id: 'shapes', name: 'Shapes', icon: 'circle-large', patterns: ['Circle', 'Square', 'Triangle', 'Star', 'Diamond', 'Hexagon', 'Pentagon'] },
]

// =============================================================================
// Iconoir Categories
// =============================================================================

export const ICONOIR_CATEGORIES: IconCategory[] = [
  { id: 'arrows', name: 'Arrows', icon: 'arrow-right', patterns: ['Arrow', 'Chevron', 'Nav', 'Direction'] },
  { id: 'files', name: 'Files', icon: 'file', patterns: ['File', 'Folder', 'Page', 'Doc', 'Clipboard', 'Copy'] },
  { id: 'media', name: 'Media', icon: 'play', patterns: ['Play', 'Pause', 'Stop', 'Music', 'Video', 'Film', 'Camera', 'Mic', 'Sound', 'Volume', 'Headphones'] },
  { id: 'design', name: 'Design', icon: 'paintcan', patterns: ['Color', 'Paint', 'Brush', 'Palette', 'Design', 'Frame', 'Crop', 'Resize', 'Rotate', 'Flip', 'Align', 'Layer'] },
  { id: 'communication', name: 'Communication', icon: 'comment', patterns: ['Chat', 'Message', 'Mail', 'Send', 'Bell', 'Notification'] },
  { id: 'users', name: 'Users', icon: 'person', patterns: ['User', 'Person', 'People', 'Group', 'Community', 'Team'] },
  { id: 'devices', name: 'Devices', icon: 'device-desktop', patterns: ['Phone', 'Tablet', 'Laptop', 'Desktop', 'Computer', 'Monitor', 'Keyboard', 'Mouse', 'Printer', 'Device', 'Apple', 'Android'] },
  { id: 'buildings', name: 'Buildings', icon: 'home', patterns: ['Home', 'House', 'Building', 'City', 'Hospital', 'Church', 'Bank', 'Store', 'Shop', 'Hotel', 'Factory'] },
  { id: 'transport', name: 'Transport', icon: 'rocket', patterns: ['Car', 'Truck', 'Bus', 'Train', 'Tram', 'Plane', 'Airplane', 'Ship', 'Boat', 'Bicycle', 'Bike', 'Motorcycle', 'Scooter'] },
  { id: 'nature', name: 'Nature', icon: 'globe', patterns: ['Tree', 'Leaf', 'Flower', 'Plant', 'Sun', 'Moon', 'Star', 'Cloud', 'Rain', 'Snow', 'Wind', 'Fire', 'Water', 'Mountain', 'Beach'] },
  { id: 'food', name: 'Food', icon: 'flame', patterns: ['Food', 'Drink', 'Coffee', 'Wine', 'Beer', 'Pizza', 'Burger', 'Cake', 'Apple', 'Fruit', 'Vegetable', 'Restaurant', 'Kitchen', 'Fork', 'Knife', 'Spoon', 'Cup', 'Glass', 'Bottle', 'Bowl'] },
  { id: 'sport', name: 'Sport', icon: 'zap', patterns: ['Sport', 'Ball', 'Football', 'Soccer', 'Basketball', 'Tennis', 'Golf', 'Gym', 'Fitness', 'Running', 'Swimming', 'Cycling'] },
  { id: 'tools', name: 'Tools', icon: 'tools', patterns: ['Tool', 'Wrench', 'Hammer', 'Screw', 'Settings', 'Gear', 'Cog', 'Config'] },
  { id: 'brands', name: 'Brands', icon: 'github', patterns: ['Adobe', 'Apple', 'Google', 'Github', 'Figma', 'Dribbble', 'Behance', 'Discord', 'Slack', 'Twitter', 'Instagram', 'Facebook', 'Linkedin', 'Youtube', 'Tiktok', 'Pinterest', 'Spotify', 'Netflix'] },
]

// =============================================================================
// Phosphor Categories
// =============================================================================

export const PHOSPHOR_CATEGORIES: IconCategory[] = [
  { id: 'arrows', name: 'Arrows', icon: 'arrow-right', patterns: ['Arrow', 'Caret', 'CaretCircle', 'CaretDouble'] },
  { id: 'files', name: 'Files', icon: 'file', patterns: ['File', 'Folder', 'Clipboard', 'Note', 'Article'] },
  { id: 'media', name: 'Media', icon: 'play', patterns: ['Play', 'Pause', 'Stop', 'Rewind', 'FastForward', 'Skip', 'Shuffle', 'Repeat', 'Music', 'Video', 'Film', 'Camera', 'Microphone', 'Speaker', 'Headphones', 'Radio'] },
  { id: 'design', name: 'Design', icon: 'paintcan', patterns: ['Paint', 'Brush', 'Palette', 'Color', 'Eyedropper', 'Crop', 'Frame', 'Image', 'Picture', 'Gradient', 'Selection', 'Path', 'Pen', 'Pencil', 'Bezier'] },
  { id: 'communication', name: 'Communication', icon: 'comment', patterns: ['Chat', 'Chats', 'Message', 'Envelope', 'At', 'Bell', 'Megaphone', 'Broadcast'] },
  { id: 'users', name: 'Users', icon: 'person', patterns: ['User', 'Users', 'Person', 'Baby', 'Student', 'Detective'] },
  { id: 'devices', name: 'Devices', icon: 'device-desktop', patterns: ['Phone', 'Device', 'Desktop', 'Laptop', 'Monitor', 'Keyboard', 'Mouse', 'Printer', 'Computer', 'Cpu', 'Disc', 'Usb', 'Bluetooth', 'Wifi', 'Battery'] },
  { id: 'buildings', name: 'Buildings', icon: 'home', patterns: ['House', 'Building', 'Buildings', 'Factory', 'Hospital', 'Church', 'Bank', 'Warehouse', 'Lighthouse', 'Barn', 'Garage', 'Storefront'] },
  { id: 'transport', name: 'Transport', icon: 'rocket', patterns: ['Car', 'Truck', 'Bus', 'Train', 'Airplane', 'Boat', 'Bicycle', 'Motorcycle', 'Scooter', 'Helicopter', 'Rocket', 'Ambulance', 'Taxi', 'Jeep'] },
  { id: 'nature', name: 'Nature', icon: 'globe', patterns: ['Tree', 'Leaf', 'Flower', 'Plant', 'Cactus', 'Grain', 'Sun', 'Moon', 'Star', 'Cloud', 'Rainbow', 'Lightning', 'Snowflake', 'Drop', 'Fire', 'Waves', 'Mountains'] },
  { id: 'animals', name: 'Animals', icon: 'bug', patterns: ['Dog', 'Cat', 'Bird', 'Fish', 'Horse', 'Bug', 'Butterfly', 'Bee', 'Spider', 'Paw', 'Bone'] },
  { id: 'food', name: 'Food', icon: 'flame', patterns: ['Food', 'Hamburger', 'Pizza', 'Cookie', 'Cake', 'IceCream', 'Coffee', 'Wine', 'Beer', 'Martini', 'Egg', 'Carrot', 'Apple', 'Orange', 'Avocado', 'Bread', 'Bowl', 'Fork', 'Knife', 'Spoon', 'Cup'] },
  { id: 'sports', name: 'Sports', icon: 'zap', patterns: ['Ball', 'Football', 'Soccer', 'Basketball', 'Baseball', 'Tennis', 'Golf', 'Barbell', 'Medal', 'Trophy', 'Flag'] },
  { id: 'tools', name: 'Tools', icon: 'tools', patterns: ['Wrench', 'Hammer', 'Screwdriver', 'Gear', 'Faders', 'Sliders', 'Toggle'] },
  { id: 'brands', name: 'Brands', icon: 'github', patterns: ['Logo', 'Discord', 'Slack', 'Twitch', 'Youtube', 'Spotify', 'Dribbble', 'Behance', 'Figma', 'Notion', 'Paypal', 'Stripe'] },
]

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get icons for a specific category
 */
export function getIconsForCategory(
  iconNames: string[],
  category: IconCategory
): string[] {
  return iconNames.filter(iconName => {
    const lowerName = iconName.toLowerCase()
    return category.patterns.some(pattern => {
      const lowerPattern = pattern.toLowerCase()
      return lowerName.startsWith(lowerPattern) || lowerName.includes(lowerPattern)
    })
  })
}

/**
 * Search and filter icons
 */
export function searchIcons(
  iconNames: string[],
  searchTerm: string
): string[] {
  if (!searchTerm) return iconNames
  const lower = searchTerm.toLowerCase()
  return iconNames.filter(name => name.toLowerCase().includes(lower))
}
